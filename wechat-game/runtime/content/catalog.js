"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unlocked = exports.SKINS = exports.SCENES = exports.WECHAT_VERSION = exports.VERSION = void 0;
exports.routeAt = routeAt;
// The retained Web entry uses legacy rules; WeChat has the new isolated wave rules.
exports.VERSION = '0.4.0';
exports.WECHAT_VERSION = '0.5.0';
exports.SCENES = [
    { id: 'auto', name: '动态航线', description: '每20秒穿越云海、星港与夜雨都市，3秒连续过渡' },
    { id: 'cloud', name: '云海', description: '高空云层与气流' },
    { id: 'orbit', name: '星港', description: '行星弧面、轨道设施与星光' },
    { id: 'city', name: '夜雨', description: '建筑纵深、航灯与雨幕' }
];
exports.SKINS = [
    { id: 'porcelain', name: '白隼', seconds: 0, description: '瓷白双翼 · 青色尾焰' },
    { id: 'cobalt', name: '蓝梭', seconds: 0, description: '窄翼巡航 · 冰蓝尾焰' },
    { id: 'ember', name: '赤鸢', seconds: 30, description: '三角翼身 · 琥珀尾焰' },
    { id: 'spectre', name: '幽影', seconds: 90, description: '隐身折翼 · 紫色尾焰' }
];
const unlocked = (id, total) => { const skin = exports.SKINS.find(s => s.id === id); return !!skin && total >= skin.seconds; };
exports.unlocked = unlocked;
function routeAt(seconds, choice) {
    const order = ['cloud', 'orbit', 'city'];
    if (choice !== 'auto')
        return { scene: choice, nextScene: choice, transition: 0 };
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0), index = Math.floor(safe / 20) % 3, phase = safe % 20;
    return { scene: order[index], nextScene: order[(index + 1) % 3], transition: Math.max(0, (phase - 17) / 3) };
}
