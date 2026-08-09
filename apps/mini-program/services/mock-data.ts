import type { Registration, RideEvent, RideRoute } from '../types/domain';

export const routes: RideRoute[] = [
  {
    id: 'route-miaofeng', name: '妙峰山经典爬坡', city: '北京市门头沟区', distanceKm: 82,
    elevationGainM: 1280, durationMinutes: 260, maxGradient: 12.4, difficulty: '进阶', cover: '/assets/ride-hero.jpg',
    track: [
      { latitude: 39.929, longitude: 116.177 }, { latitude: 39.948, longitude: 116.139 },
      { latitude: 39.972, longitude: 116.103 }, { latitude: 40.002, longitude: 116.073 },
      { latitude: 40.033, longitude: 116.045 }, { latitude: 40.056, longitude: 116.017 },
    ],
    elevationProfile: [110, 130, 180, 250, 340, 460, 610, 790, 920, 1110, 1240, 1010, 680, 360, 160],
    pois: [
      { id: 'p1', name: '苹果园地铁站', distanceKm: 0, note: '06:30 集合点名', kind: 'meeting', latitude: 39.929, longitude: 116.177 },
      { id: 'p2', name: '担礼村补给', distanceKm: 31, note: '饮水与简餐', kind: 'supply', latitude: 39.972, longitude: 116.103 },
      { id: 'p3', name: '连续弯道路段', distanceKm: 49, note: '控制速度，禁止超车', kind: 'risk', latitude: 40.033, longitude: 116.045 },
      { id: 'p4', name: '妙峰山牌楼', distanceKm: 82, note: '终点合影', kind: 'finish', latitude: 40.056, longitude: 116.017 },
    ],
  },
  {
    id: 'route-shisanling', name: '十三陵水库环线', city: '北京市昌平区', distanceKm: 67,
    elevationGainM: 680, durationMinutes: 190, maxGradient: 8.6, difficulty: '中等', cover: '/assets/route-mountain.jpg',
    track: [
      { latitude: 40.195, longitude: 116.216 }, { latitude: 40.238, longitude: 116.185 },
      { latitude: 40.292, longitude: 116.211 }, { latitude: 40.268, longitude: 116.282 },
      { latitude: 40.216, longitude: 116.292 }, { latitude: 40.195, longitude: 116.216 },
    ],
    elevationProfile: [45, 60, 95, 140, 210, 340, 480, 390, 270, 180, 130, 85, 60],
    pois: [
      { id: 's1', name: '北邵洼地铁站', distanceKm: 0, note: '出发与返程点', kind: 'meeting', latitude: 40.195, longitude: 116.216 },
      { id: 's2', name: '水库北岸', distanceKm: 29, note: '便利店补水', kind: 'supply', latitude: 40.292, longitude: 116.211 },
      { id: 's3', name: '蟒山下坡', distanceKm: 43, note: '急弯较多，保持车距', kind: 'risk', latitude: 40.268, longitude: 116.282 },
    ],
  },
];

export const events: RideEvent[] = [
  {
    id: 'event-miaofeng', title: '妙峰山晨骑挑战', organizer: '北纬骑行俱乐部', startAt: '2026-08-08T06:30:00+08:00', registrationDeadline: '2026-08-07T18:30:00+08:00',
    meetingPoint: '苹果园地铁站 D 口', routeId: 'route-miaofeng', route: routes[0], capacity: 20, registeredCount: 13,
    speedRange: '25-28 km/h', status: 'published', approvalRequired: true,
    description: '山脚按能力分组，山顶统一合影。返程在担礼村补给；遇中雨或道路管制将提前取消并通知。',
    requirements: {
      equipment: ['骑行头盔', '前后车灯', '补胎工具', '备用内胎'], recentDistanceKm: 70, recentElevationM: 800,
      bikeTypes: ['公路车', '砾石车'], disciplines: ['听从领队指挥', '下坡禁止超车', '掉队原地等待收队'],
      customNote: '连续爬坡约 11 km，请谨慎评估能力。',
    },
  },
  {
    id: 'event-shisanling', title: '十三陵水库周末拉练', organizer: '骑哪儿', startAt: '2026-08-15T06:30:00+08:00', registrationDeadline: '2026-08-14T18:30:00+08:00',
    meetingPoint: '北邵洼地铁站 B 口', routeId: 'route-shisanling', route: routes[1], capacity: 16, registeredCount: 8,
    speedRange: '23-26 km/h', status: 'published', approvalRequired: false,
    description: '稳定巡航，设置领队与收队，适合有一定集团骑行经验的骑友。',
    requirements: {
      equipment: ['骑行头盔', '补胎工具', '备用内胎'], recentDistanceKm: 50, recentElevationM: 400,
      bikeTypes: ['公路车', '砾石车'], disciplines: ['听从领队指挥', '保持安全车距'],
    },
  },
];

export const initialRegistrations: Registration[] = [];
