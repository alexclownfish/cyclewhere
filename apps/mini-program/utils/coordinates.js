"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wgs84ToGcj02 = wgs84ToGcj02;
exports.gcj02ToWgs84 = gcj02ToWgs84;
const PI = Math.PI;
const AXIS = 6378245;
const OFFSET = 0.006693421622965943;
function outsideChina(latitude, longitude) {
    return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}
function transformLatitude(x, y) {
    let value = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    value += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
    value += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
    return value;
}
function transformLongitude(x, y) {
    let value = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    value += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
    value += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
    return value;
}
// 后端永久保存 WGS84；只有传给微信地图组件和 openLocation 时才转换为 GCJ-02。
function wgs84ToGcj02(coordinate) {
    const { latitude, longitude } = coordinate;
    if (outsideChina(latitude, longitude))
        return { latitude, longitude };
    let latitudeDelta = transformLatitude(longitude - 105, latitude - 35);
    let longitudeDelta = transformLongitude(longitude - 105, latitude - 35);
    const radianLatitude = latitude / 180 * PI;
    let magic = Math.sin(radianLatitude);
    magic = 1 - OFFSET * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    latitudeDelta = latitudeDelta * 180 / ((AXIS * (1 - OFFSET)) / (magic * sqrtMagic) * PI);
    longitudeDelta = longitudeDelta * 180 / (AXIS / sqrtMagic * Math.cos(radianLatitude) * PI);
    return { latitude: latitude + latitudeDelta, longitude: longitude + longitudeDelta };
}
function gcj02ToWgs84(coordinate) {
    if (outsideChina(coordinate.latitude, coordinate.longitude))
        return { ...coordinate };
    let latitude = coordinate.latitude;
    let longitude = coordinate.longitude;
    for (let iteration = 0; iteration < 4; iteration++) {
        const converted = wgs84ToGcj02({ latitude, longitude });
        latitude -= converted.latitude - coordinate.latitude;
        longitude -= converted.longitude - coordinate.longitude;
    }
    return { latitude, longitude };
}
