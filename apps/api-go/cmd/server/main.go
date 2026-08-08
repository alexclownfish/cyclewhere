package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cyclewhere/api-go/internal/auth"
	"cyclewhere/api-go/internal/config"
	"cyclewhere/api-go/internal/httpapi"
	"cyclewhere/api-go/internal/security"
	"cyclewhere/api-go/internal/service"
	"cyclewhere/api-go/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Printf("server stopped: %v", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("Go API requires DATABASE_URL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	repository, err := store.Open(ctx, cfg.DatabaseURL, int32(cfg.DatabasePoolSize))
	if err != nil {
		return err
	}
	defer repository.Close()

	issuer, err := auth.NewIssuer(cfg.AuthSecret)
	if err != nil {
		return err
	}
	verifier, err := auth.NewVerifier(cfg.AuthSecret)
	if err != nil {
		return err
	}
	encryptor, err := security.NewFieldEncryptor(cfg.FieldEncryptionKey)
	if err != nil {
		return err
	}
	var wechat auth.WeChatSessionGateway = auth.DisabledWeChatSessionGateway{}
	var wechatPhone auth.WeChatPhoneGateway = auth.DisabledWeChatSessionGateway{}
	if cfg.WeChatAppID != "" && cfg.WeChatAppSecret != "" {
		gateway, gatewayErr := auth.NewWeChatHTTPGateway(cfg.WeChatAppID, cfg.WeChatAppSecret)
		err = gatewayErr
		if err != nil {
			return err
		}
		wechat = gateway
		wechatPhone = gateway
	}
	catalog := service.NewCatalog(repository, time.Now)
	router, err := httpapi.NewRouter(httpapi.Dependencies{
		Repository: repository, Catalog: catalog, Issuer: issuer, Verifier: verifier,
		WeChat: wechat, WeChatPhone: wechatPhone, Encryptor: encryptor, AvatarUploadDir: cfg.AvatarUploadDir,
	})
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr: cfg.Host + ":" + fmt.Sprint(cfg.Port), Handler: router,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 32 * 1024,
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("Go API listening on %s", server.Addr)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
