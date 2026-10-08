// DOM overlay in the same inked comic style as the site: chamfered caption boxes with a thick ink
// line, cel-shaded lip and grime (painted at boot in hudArt.ts), hand-lettered display type.
// Site card with the automation goal and rate meter, planet route (site progression), toolbar,
// inspector, station orders and the automation celebration. Laid out to stay readable on the
// 1024x600 in-game screen. Elements are built once and patched in place, so hover states,
// clicks and CSS animations survive the periodic refresh.

import '@fontsource/bangers/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import type Phaser from 'phaser';
import { ASSEMBLY, BUILD_ORDER, BUILDINGS, ITEMS, MACHINE_BUFFER, type BuildingKind, type ItemId } from '../sim/defs';
import type { Campaign } from '../sim/campaign';
import { diagnose, type Diagnosis } from '../sim/status';
import type { Entity } from '../sim/world';
import type { FactoryScene } from './FactoryScene';
import { GLYPH, frame, grime, starburst } from './hudArt';
import { statusLook } from './status';

const TOOL_TIPS: Record<BuildingKind, string> = {
  belt: 'Carries goods. Drag to lay a line.',
  inserter: 'Lifts goods from behind and drops them in front.',
  miner: 'Drills the ore it stands on. 2×2.',
  furnace: 'Smelts ore into bars. Burns carbon. 2×2.',
  assembler: 'Fabricates parts from a chosen recipe. 3×3.',
  chest: 'Stores goods.',
  elevator: 'Sends goods up to the station.',
  importer: 'Delivers goods from another site.',
};

/** Rate meter range, as a multiple of the target: the goal notch sits at 1 / METER_SPAN. */
const METER_SPAN = 1.25;

const CSS = `
#hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;font:600 15px/1.2 var(--body);color:var(--ink);user-select:none;-webkit-user-select:none;
  --ink:#1a1214;--paper:#f1dfb8;--paper2:#e4c992;--shade:#c9a464;--hazard:#f6bd2c;--hazard2:#d98d12;--ok:#8fd14a;--ok2:#4f9a2a;--bad:#e2513a;--dark:#2c2030;--dark2:#3e2f45;--teal:#4fd1bd;
  --disp:'Bangers',Impact,'Arial Black',sans-serif;--body:'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif}
#hud *{box-sizing:border-box}
#hud svg{display:block;width:100%;height:100%}
#hud img{display:block;image-rendering:auto}
#hud .box{pointer-events:auto}
#hud .pnl{position:absolute;border:12px solid transparent;border-image:var(--fr-paper) 48 / 24px round;background:var(--grime-paper) 0 0/128px 128px;background-clip:padding-box}
#hud .pnl.dark{border-image:var(--fr-dark) 48 / 24px round;background:var(--grime-dark) 0 0/128px 128px;background-clip:padding-box;color:var(--paper)}
#hud .pnl.hz{border-image:var(--fr-hz) 48 / 24px round;background:var(--grime-hz) 0 0/128px 128px;background-clip:padding-box}
#hud .tag{position:absolute;left:-4px;top:-27px;font:400 15px/1 var(--disp);letter-spacing:.06em;color:var(--hazard);background:var(--ink);padding:4px 12px 3px 10px;transform:rotate(-2deg);clip-path:polygon(0 0,100% 0,calc(100% - 7px) 100%,0 100%);white-space:nowrap;display:flex;gap:6px;align-items:center}
#hud .tag svg{width:15px;height:15px}
#hud h1,#hud h2{font-family:var(--disp);font-weight:400;letter-spacing:.035em;margin:0;line-height:.95;text-transform:uppercase}
#hud .sock{flex:none;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#4a3a50 0 55%,#2c2030 56%);border:3px solid var(--ink);box-shadow:inset 0 -4px 0 rgba(0,0,0,.35),0 2px 0 var(--ink);display:grid;place-items:center;position:relative}
#hud .sock img{width:82%;height:82%}
#hud .sock.sm{width:34px;height:34px;border-width:2.5px}
#hud .lbl{white-space:nowrap;font:700 11px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:#7a5a3a}
#hud .num{font-family:var(--disp);font-weight:400;letter-spacing:.04em;font-variant-numeric:tabular-nums}

/* site card */
#site{left:10px;top:24px;width:318px;display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:2px 3px 1px}
#site h1{font-size:31px;color:var(--ink);text-shadow:2px 2px 0 rgba(246,189,44,.55)}
#site .blurb{font-weight:500;font-size:15px;color:#4e3826;line-height:1.15}
#site .goal{display:flex;align-items:center;gap:9px;padding:6px 8px 6px 6px;background:rgba(201,164,100,.35);border:2px solid rgba(26,18,20,.55);border-radius:3px}
#site .goal .sock{width:50px;height:50px}
#site .gname{display:grid;gap:2px}
#site .gname b{font:400 23px/1 var(--disp);letter-spacing:.04em}
#site .stamp{margin-left:auto;font:400 17px/1 var(--disp);letter-spacing:.06em;padding:5px 9px 3px;border:3px solid var(--ink);transform:rotate(-5deg);white-space:nowrap}
#site .stamp.goal-s{background:var(--paper);color:var(--ink)}
#site .stamp.done{background:var(--ok);color:var(--ink);box-shadow:2px 3px 0 var(--ink);animation:stampIn .45s cubic-bezier(.3,1.7,.5,1) both}
#site .meter{position:relative;height:24px;margin:6px 0 2px;border:3px solid var(--ink);border-radius:3px;background:repeating-linear-gradient(-45deg,#2c2030 0 5px,#382a3d 5px 7px);box-shadow:0 3px 0 rgba(26,18,20,.45)}
#site .meter .fill{position:absolute;inset:0 auto 0 0;width:0;transition:width .45s cubic-bezier(.3,.8,.4,1);background:repeating-linear-gradient(-45deg,var(--hazard) 0 9px,#f9d364 9px 13px,var(--hazard2) 13px 18px) 0 0/25.46px 25.46px;border-right:3px solid var(--ink);animation:crawl 1.2s linear infinite;box-shadow:inset 0 4px 0 rgba(255,246,210,.45),inset 0 -5px 0 rgba(120,60,0,.35)}
#site .meter .fill[style*="width: 0"]{border-right:0}
#site .meter.kick .fill{animation:crawl 1.2s linear infinite,kick .45s ease-out}
#site .meter.done .fill{background:repeating-linear-gradient(-45deg,var(--ok) 0 9px,#b6ea76 9px 13px,#6fb63a 13px 18px) 0 0/25.46px 25.46px}
#site .meter .notch{position:absolute;top:-9px;bottom:-9px;width:5px;margin-left:-2.5px;background:var(--ink);border-radius:1px}
#site .meter .notch::after{content:"";position:absolute;left:50%;top:-1px;width:12px;height:9px;background:var(--bad);border:2px solid var(--ink);transform:translateX(-1px);clip-path:polygon(0 0,100% 50%,0 100%)}
#site .meter.done .notch::after{background:var(--ok)}
#site .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
#site .rate b{font:400 27px/1 var(--disp);letter-spacing:.03em;font-variant-numeric:tabular-nums}
#site .rate span{font-weight:700;color:#5a4030}
#site .rate.done b{color:var(--ok2)}
#site .cost{display:flex;align-items:center;gap:4px;font-weight:700;color:#5a4030}
#site .cost svg{width:16px;height:16px}
#site .cost b{color:var(--ink)}
#site.celebrate{animation:shake .5s ease-out}

/* trouble strip: stuck machines, worst first, under the goal */
#alerts{position:absolute;left:16px;top:230px;display:flex;flex-direction:column;align-items:flex-start;gap:5px}
#alerts:empty{display:none}
#alerts button{pointer-events:auto;position:relative;display:flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 3px;border:0;background:var(--ink);color:var(--paper);cursor:pointer;clip-path:polygon(0 0,100% 0,calc(100% - 7px) 100%,0 100%);box-shadow:inset 0 0 0 2px var(--c);font:400 16px/1 var(--disp);letter-spacing:.05em;white-space:nowrap;animation:slideIn .25s cubic-bezier(.3,1.4,.5,1);transition:transform .12s}
#alerts button:hover{transform:translateX(3px)}
#alerts button.bad{--c:#e8361f}
#alerts button.warn{--c:#f6bd2c}
#alerts button.wrong{--c:#9b52e0}
#alerts button.bad .sg{animation:blink .8s steps(2) infinite}
#alerts .sg{position:relative;width:24px;height:26px;flex:none}
#alerts .sg img{position:absolute;display:block}
#alerts .sg .pl{inset:0;width:24px;height:26px}
#alerts .sg .it{left:6px;top:5.5px;width:12px;height:12px}
#alerts .what{display:grid;gap:1px;text-align:left}
#alerts .what small{font:700 10px/1 var(--body);letter-spacing:.1em;text-transform:uppercase;color:#bfa98a}
#alerts .more{font:700 12px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--paper);background:rgba(26,18,20,.8);padding:3px 7px 2px;border-radius:2px}
#alerts .n{font-size:14px;color:var(--c);margin-left:2px}

/* credits */
#credits{left:50%;top:10px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:0 6px 0 2px}
#credits .coin{width:34px;height:34px;transition:transform .2s}
#credits b{font:400 32px/1 var(--disp);letter-spacing:.04em;font-variant-numeric:tabular-nums;min-width:2ch;text-align:right}
#credits small{font:700 11px/1.05 var(--body);letter-spacing:.12em;text-transform:uppercase;color:#5c3a10;width:52px}
#credits.pop .coin{transform:rotate(-18deg) scale(1.22)}
#credits.pop b{animation:pop .3s ease-out}
#flyers{position:absolute;left:50%;top:100%;width:0;height:0}
#flyers span{position:absolute;left:0;top:0;transform:translateX(-50%);font:400 22px/1 var(--disp);letter-spacing:.04em;color:var(--hazard);-webkit-text-stroke:1.2px var(--ink);text-shadow:2px 2px 0 var(--ink);white-space:nowrap;animation:fly 1.3s ease-out forwards}

/* planet route */
#sites{right:10px;top:24px;padding:3px 2px 2px}
#sites .route{display:flex;align-items:center}
#sites .link{width:14px;height:8px;margin:0 -2px;border:2px solid var(--ink);background:repeating-linear-gradient(90deg,#3e2f45 0 4px,#6d5a78 4px 7px);position:relative;z-index:0}
#sites .link.on{background:repeating-linear-gradient(-45deg,var(--hazard) 0 4px,var(--ink) 4px 7px)}
#sites button{position:relative;z-index:1;width:44px;height:44px;padding:0;border:3px solid var(--ink);border-radius:50%;background:var(--paper2);cursor:pointer;display:grid;place-items:center;box-shadow:inset 0 -5px 0 rgba(120,80,30,.35),0 3px 0 var(--ink);transition:transform .15s}
#sites button img{width:30px;height:30px}
#sites button:hover{transform:translateY(-2px)}
#sites button.done{background:#b8e07e;box-shadow:inset 0 -5px 0 rgba(40,100,20,.35),0 3px 0 var(--ink)}
#sites button.on{width:52px;height:52px;background:var(--hazard);box-shadow:inset 0 -6px 0 rgba(160,90,0,.45),0 3px 0 var(--ink),0 0 0 4px rgba(26,18,20,.9),0 0 0 7px var(--hazard)}
#sites button.on img{width:36px;height:36px}
#sites button.locked{background:#3e2f45;cursor:not-allowed;box-shadow:inset 0 -5px 0 rgba(0,0,0,.35),0 3px 0 var(--ink)}
#sites button.locked:hover{transform:none}
#sites button.locked img{filter:brightness(0) opacity(.35)}
#sites button .lk{position:absolute;inset:9px;display:grid}
#sites button .ck{position:absolute;right:-8px;top:-8px;width:21px;height:21px;border:2.5px solid var(--ink);border-radius:50%;background:var(--ok2);padding:1px}
#sites button.fresh{animation:beckon 1.1s ease-in-out infinite}
#sites button.fresh::after{content:"NEW";position:absolute;left:50%;bottom:-13px;transform:translateX(-50%) rotate(-4deg);font:400 11px/1 var(--disp);letter-spacing:.08em;background:var(--bad);color:#fff;border:2px solid var(--ink);padding:2px 4px 1px}

/* toolbar */
#bar{left:50%;bottom:8px;transform:translateX(-50%);display:flex;gap:7px;padding:1px 2px 0}
#bar .tool{position:relative;width:62px;height:62px;padding:0;border:10px solid transparent;border-image:var(--fr-slot) 32 / 16px round;background:transparent;cursor:pointer;display:grid;place-items:center;transition:transform .12s}
#bar .tool img{width:52px;height:52px;margin:-6px;pointer-events:none}
#bar .tool:hover{border-image-source:var(--fr-slot-hi);transform:translateY(-2px)}
#bar .tool.on{border-image-source:var(--fr-slot-on);transform:translateY(-6px)}
#bar .tool.on::after{content:"";position:absolute;left:50%;bottom:-19px;width:14px;height:8px;margin-left:-7px;background:var(--hazard);border:2px solid var(--ink);clip-path:polygon(50% 0,100% 100%,0 100%)}
#bar .key{position:absolute;left:-8px;top:-8px;width:17px;height:17px;font:400 13px/16px var(--disp);text-align:center;color:var(--hazard);background:var(--ink);border-radius:3px;box-shadow:0 2px 0 rgba(0,0,0,.4)}
#bar .cost{position:absolute;right:-9px;bottom:-9px;font:700 11px/1 var(--body);padding:2px 4px 1px;background:var(--paper);border:2px solid var(--ink);border-radius:2px;font-variant-numeric:tabular-nums}
#hint{position:absolute;left:50%;bottom:98px;transform:translateX(-50%);display:none;gap:10px;align-items:center;padding:5px 12px 4px;background:rgba(26,18,20,.88);color:var(--paper);font:600 14px/1 var(--body);border-radius:3px;white-space:nowrap;box-shadow:3px 3px 0 rgba(0,0,0,.35)}
#hint.show{display:flex}
#hint b{font:400 17px/1 var(--disp);letter-spacing:.05em;color:var(--hazard)}
#hud kbd{display:inline-block;min-width:19px;padding:2px 4px 1px;margin-right:3px;font:700 12px/1.1 var(--body);text-align:center;color:var(--ink);background:var(--paper);border:2px solid var(--ink);border-bottom-width:3px;border-radius:3px}
#help{position:absolute;right:12px;bottom:14px;display:flex;gap:10px;align-items:center;padding:5px 10px 4px;background:rgba(26,18,20,.78);color:var(--paper);font:600 13px/1 var(--body);border-radius:3px;white-space:nowrap}

/* tooltip */
#tip{position:absolute;z-index:5;max-width:240px;padding:7px 10px 6px;background:var(--ink);color:var(--paper);border:2px solid var(--hazard);box-shadow:3px 4px 0 rgba(0,0,0,.45);display:none;pointer-events:none;clip-path:polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)}
#tip.show{display:block}
#tip h2{font-size:19px;color:var(--hazard);margin-bottom:3px}
#tip p{margin:0;font-weight:500;line-height:1.15}
#tip .meta{margin-top:5px;display:flex;gap:8px;font:700 12px/1 var(--body);letter-spacing:.06em;text-transform:uppercase;color:#d9c39a}

/* inspector */
#panel{right:10px;top:122px;width:268px;display:none;padding:0 2px 1px}
#panel.show{display:block;animation:slideIn .22s cubic-bezier(.3,1.3,.5,1)}
#panel header{display:flex;align-items:center;gap:8px;margin:-2px 0 8px;padding-bottom:7px;border-bottom:3px solid var(--ink);position:relative}
#panel header .mi{width:46px;height:46px;flex:none;border:3px solid var(--ink);background:#a88b5e;border-radius:3px;display:grid;place-items:center;overflow:hidden;box-shadow:inset 0 -5px 0 rgba(0,0,0,.25)}
#panel header .mi img{width:52px;height:52px}
#panel header h2{font-size:25px}
#panel header .x{margin-left:auto;align-self:flex-start;width:24px;height:24px;padding:3px;border:2px solid var(--ink);border-radius:3px;background:var(--paper2);cursor:pointer}
#panel header .x:hover{background:var(--hazard)}
#panel .status{display:flex;align-items:center;gap:7px;font-weight:700;font-size:15px;margin-bottom:8px}
#panel .lamp{width:13px;height:13px;border-radius:50%;border:2.5px solid var(--ink);flex:none;background:#8a7a70}
#panel .lamp.ok{background:var(--ok);box-shadow:0 0 0 3px rgba(143,209,74,.35);animation:blink 1.4s ease-in-out infinite}
#panel .lamp.warn{background:var(--hazard)}
#panel .lamp.bad{background:var(--bad);animation:blink .7s steps(2) infinite}
#panel .flow{display:flex;align-items:center;justify-content:center;gap:7px;padding:7px 6px;background:rgba(201,164,100,.35);border:2px solid rgba(26,18,20,.55);border-radius:3px}
#panel .flow .op{width:16px;height:16px;flex:none;opacity:.8}
#panel .flow .to{width:26px;height:22px;flex:none}
#panel .slot{position:relative;flex:none}
#panel .slot .sock{width:46px;height:46px}
#panel .slot.want .sock{box-shadow:0 0 0 3px var(--hazard),0 0 0 5px var(--ink);animation:beckon .9s ease-in-out infinite}
#panel .slot.want.bad .sock{box-shadow:0 0 0 3px var(--bad),0 0 0 5px var(--ink)}
#panel .slot.empty .sock img{filter:brightness(0) opacity(.3)}
#panel .slot b{position:absolute;right:-6px;bottom:-5px;min-width:22px;padding:1px 4px 0;font:400 16px/1.05 var(--disp);letter-spacing:.03em;text-align:center;background:var(--paper);border:2px solid var(--ink);border-radius:3px;font-variant-numeric:tabular-nums}
#panel .slot b.full{background:var(--bad);color:#fff}
#panel .slot i{position:absolute;left:-6px;top:-6px;font:700 11px/1 var(--body);font-style:normal;padding:2px 3px 1px;background:var(--ink);color:var(--hazard);border-radius:2px}
#panel .slot small{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%);font:700 10px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;color:#6e5038;white-space:nowrap}
#panel .flow.lbls{padding-bottom:20px}
#panel .prog{height:12px;margin-top:8px;border:2.5px solid var(--ink);border-radius:2px;background:#2c2030;overflow:hidden}
#panel .prog i{display:block;height:100%;width:0;background:linear-gradient(var(--ok) 0 55%,var(--ok2) 55%);border-right:2px solid var(--ink)}
#panel .recipes{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
#panel .recipes button{border:3px solid var(--ink);border-radius:3px;background:var(--paper2);padding:4px 2px 3px;cursor:pointer;display:grid;justify-items:center;gap:1px;font:400 14px/1 var(--disp);letter-spacing:.05em;color:var(--ink);box-shadow:inset 0 -4px 0 rgba(120,80,30,.3);transition:transform .1s}
#panel .recipes button img{width:34px;height:34px}
#panel .recipes button:hover{transform:translateY(-2px);background:#f0d89c}
#panel .recipes button.on{background:var(--hazard);box-shadow:inset 0 -4px 0 rgba(160,90,0,.45),0 0 0 2px var(--paper),0 0 0 4px var(--ink)}
#panel .big{display:flex;align-items:baseline;gap:6px}
#panel .big b{font:400 30px/1 var(--disp);letter-spacing:.03em}
#panel .grid{display:flex;flex-wrap:wrap;gap:12px 14px;padding:6px 4px}
#panel .note{font-weight:500;color:#5a4030;font-size:14px}
#panel .foot{display:flex;align-items:center;gap:5px;margin-top:9px;padding-top:6px;border-top:2px dashed rgba(26,18,20,.35);font-weight:600;font-size:13px;color:#5a4030}
#panel .foot svg{width:15px;height:15px;flex:none}
#panel .foot span{margin-left:auto;display:flex;align-items:center;gap:3px}

/* station orders */
#orders{left:10px;bottom:8px;width:282px;display:none;padding:2px 2px 0}
#orders.show{display:block}
#orders .tag .lampd{width:9px;height:9px;border-radius:50%;background:#ff5a3c;animation:blink 1s steps(2) infinite}
#orders .ord{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 9px;padding:6px 4px;position:relative}
#orders .ord + .ord{border-top:2px dashed rgba(26,18,20,.3)}
#orders .ord .sock{grid-row:span 2}
#orders .ord .nm{font:400 19px/1 var(--disp);letter-spacing:.03em;white-space:nowrap;min-width:0}
#orders .ord .nm em{font-style:normal;color:#8a5a20}
#orders .ord .rew{display:flex;align-items:center;gap:3px;font:400 19px/1 var(--disp);letter-spacing:.03em;color:#7a4a08}
#orders .ord .rew svg{width:18px;height:18px}
#orders .ord .ob{grid-column:2 / span 2;display:flex;align-items:center;gap:7px}
#orders .ord .ob .prog{flex:1;height:11px;border:2.5px solid var(--ink);border-radius:2px;background:#2c2030;overflow:hidden}
#orders .ord .ob .prog i{display:block;height:100%;width:0;background:repeating-linear-gradient(-45deg,var(--hazard) 0 5px,var(--hazard2) 5px 8px);transition:width .4s}
#orders .ord .ob small{font:700 13px/1 var(--body);font-variant-numeric:tabular-nums;min-width:38px;text-align:right}
#orders .ord.new{animation:slideIn .35s cubic-bezier(.3,1.4,.5,1)}
#orders .ord.paid{animation:paidOut 1.5s ease-in forwards}
#orders .ord .paidst{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-8deg);font:400 20px/1 var(--disp);letter-spacing:.06em;white-space:nowrap;color:#fff;background:var(--ok2);border:3px solid var(--ink);padding:4px 9px 2px;box-shadow:3px 3px 0 var(--ink);display:none}
#orders .ord.paid .paidst{display:block;animation:stampIn .35s cubic-bezier(.3,1.7,.5,1) both}

/* automation celebration */
#burst{position:absolute;inset:0;display:none;place-items:center;pointer-events:none;z-index:10}
#burst.show{display:grid}
#burst .flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 46%,rgba(255,236,170,.75),rgba(255,200,80,.25) 40%,rgba(26,18,20,.45) 100%);animation:flash 3.9s ease-out forwards}
#burst .rays{position:absolute;left:50%;top:46%;width:180vmax;height:180vmax;margin:-90vmax 0 0 -90vmax;background:repeating-conic-gradient(rgba(246,189,44,.34) 0 7deg,rgba(246,189,44,0) 7deg 15deg);-webkit-mask:radial-gradient(circle,#000 8%,transparent 45%);mask:radial-gradient(circle,#000 8%,transparent 45%);animation:spin 14s linear infinite,raysIn 3.9s ease-out forwards}
#burst .card{position:relative;width:min(640px,86vw);aspect-ratio:640/440;display:grid;place-items:center;animation:boomIn 3.9s cubic-bezier(.25,1.6,.45,1) forwards}
#burst .boom{position:absolute;inset:0}
#burst .core{position:relative;display:grid;justify-items:center;gap:min(8px,1.2vh);width:72%;margin-top:-1%}
#burst .prod{width:min(84px,13vmin);height:min(84px,13vmin);border-width:4px;animation:spinIn .7s .15s cubic-bezier(.3,1.6,.5,1) both}
#burst .title{width:100%;height:min(96px,15vmin);margin-top:-2px}
#burst .sub{font:400 min(21px,3.4vmin)/1 var(--disp);letter-spacing:.05em;background:var(--ink);color:var(--paper);padding:6px 12px 4px;transform:rotate(-2deg);white-space:nowrap}
#burst .unlock{display:flex;align-items:center;gap:8px;margin-top:4px;padding:4px 12px 4px 5px;background:var(--paper);border:3px solid var(--ink);box-shadow:3px 4px 0 var(--ink);transform:rotate(2deg);font:700 min(16px,2.8vmin)/1.05 var(--body);animation:slideUp .4s 1s cubic-bezier(.3,1.5,.5,1) both;white-space:nowrap}
#burst .unlock b{font:400 min(20px,3.2vmin)/1 var(--disp);letter-spacing:.04em;display:block}
#burst .unlock .sock{width:38px;height:38px}
#burst .unlock .nw{font:400 13px/1 var(--disp);letter-spacing:.08em;color:#fff;background:var(--bad);border:2px solid var(--ink);padding:3px 5px 1px;transform:rotate(-6deg)}
#burst .bits{position:absolute;left:50%;top:46%;width:0;height:0}
#burst .bits span{position:absolute;left:-12px;top:-12px;width:24px;height:24px;animation:bit 1.9s cubic-bezier(.15,.75,.4,1) forwards;animation-delay:var(--d)}
#burst .bits span.chip{width:14px;height:9px;left:-7px;top:-4px;border:2px solid var(--ink);background:var(--c)}
#burst.out .card{animation:boomOut .35s ease-in forwards}
#burst.out .flash,#burst.out .rays{animation:fadeOut .35s forwards}

@keyframes crawl{to{background-position:25.46px 0}}
@keyframes kick{0%{filter:brightness(1.7) saturate(1.3)}100%{filter:none}}
@keyframes stampIn{0%{transform:scale(2.2) rotate(-14deg);opacity:0}100%{transform:scale(1) rotate(-5deg);opacity:1}}
@keyframes pop{40%{transform:scale(1.18)}}
@keyframes fly{0%{opacity:0;transform:translate(-50%,-4px) scale(.6)}15%{opacity:1;transform:translate(-50%,6px) scale(1.15)}100%{opacity:0;transform:translate(-50%,34px) scale(1)}}
@keyframes beckon{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes slideIn{from{opacity:0;transform:translateX(24px)}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px) rotate(2deg)}}
@keyframes paidOut{0%,65%{opacity:1}100%{opacity:0;transform:translateX(-30px)}}
@keyframes blink{50%{opacity:.45}}
@keyframes shake{0%,100%{transform:none}20%{transform:translate(-3px,1px) rotate(-.6deg)}40%{transform:translate(3px,-1px) rotate(.5deg)}60%{transform:translate(-2px,0)}80%{transform:translate(1px,0)}}
@keyframes flash{0%{opacity:0}6%{opacity:1}75%{opacity:.85}100%{opacity:0}}
@keyframes raysIn{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes boomIn{0%{transform:scale(.2) rotate(-14deg);opacity:0}9%{transform:scale(1.06) rotate(-3deg);opacity:1}14%{transform:scale(1) rotate(-4deg)}88%{transform:scale(1.02) rotate(-4deg);opacity:1}100%{transform:scale(1.25) rotate(-2deg);opacity:0}}
@keyframes boomOut{to{transform:scale(1.3) rotate(-2deg);opacity:0}}
@keyframes fadeOut{to{opacity:0}}
@keyframes spinIn{from{transform:scale(0) rotate(-200deg)}}
@keyframes bit{0%{transform:translate(0,0) rotate(0) scale(.4);opacity:0}8%{opacity:1}55%{transform:translate(var(--x),var(--y)) rotate(var(--r)) scale(1);opacity:1}100%{transform:translate(calc(var(--x) * 1.15),calc(var(--y) + 140px)) rotate(calc(var(--r) * 2)) scale(.9);opacity:0}}

@media (max-width:1180px),(max-height:700px){
  #hud{font-size:14px}
  #site{width:250px;gap:4px;top:22px}
  #site h1{font-size:25px}
  #site .blurb{font-size:13.5px;line-height:1.1}
  #site .goal{padding:4px 6px 4px 4px}
  #site .goal{gap:7px}
  #site .goal .sock{width:40px;height:40px}
  #site .gname b{font-size:19px}
  #site .stamp{font-size:13px;padding:4px 6px 2px;border-width:2.5px}
  #site .meter{height:20px;margin-top:4px}
  #site .rate b{font-size:23px}
  #credits b{font-size:27px}
  #credits .coin{width:28px;height:28px}
  #sites button{width:38px;height:38px}
  #sites button img{width:26px;height:26px}
  #sites button.on{width:46px;height:46px}
  #sites button.on img{width:32px;height:32px}
  #panel{width:244px;top:108px}
  #panel header .mi{width:40px;height:40px}
  #panel header h2{font-size:22px}
  #panel .slot .sock{width:40px;height:40px}
  #bar .tool{width:54px;height:54px}
  #bar .tool img{width:46px;height:46px}
  #hint{bottom:86px}
  #orders{width:250px}
  #orders .ord .sock{width:36px;height:36px}
  #orders .ord .nm,#orders .ord .rew{font-size:17px}
  #help{display:none}
}
`;

interface OrderView {
  el: HTMLDivElement;
  bar: HTMLElement;
  count: HTMLElement;
}

export class Hud {
  private root: HTMLDivElement;
  private site: HTMLElement;
  private creditsBox: HTMLElement;
  private credits: HTMLElement;
  private flyers: HTMLElement;
  private sites: HTMLElement;
  private route: HTMLElement;
  private bar: HTMLElement;
  private hint: HTMLElement;
  private tip: HTMLElement;
  private panel: HTMLElement;
  private orders: HTMLElement;
  private orderList: HTMLElement;
  private burst: HTMLElement;
  private alertsBox: HTMLElement;
  private alertsSig = '';
  private shipped = -1;
  /** Which machine of each alert group a click last jumped to. */
  private alertTurn = new Map<string, number>();
  private icons = new Map<string, string>();
  private lastPanel = 0;
  private lastSite = 0;
  private siteKey = '';
  private panelSig = '';
  private shownCredits = 0;
  private lastCredits = 0;
  private pendingGain = 0;
  private lastFlyer = 0;
  private popTimer = 0;
  private burstTimers: number[] = [];
  private fresh = new Set<string>();
  private orderViews = new Map<string, OrderView>();
  private ordersCampaign: Campaign | null = null;

  constructor(private scene: FactoryScene) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.paintArt();
    this.root.innerHTML = `
      <section id="site" class="pnl box"></section>
      <div id="alerts"></div>
      <div id="credits" class="pnl hz box"><span class="coin">${GLYPH.coin}</span><b class="num">0</b><small>station credits</small><div id="flyers"></div></div>
      <section id="sites" class="pnl box"><span class="tag">Planet route</span><div class="route"></div></section>
      <section id="panel" class="pnl box"></section>
      <section id="orders" class="pnl box"><span class="tag"><i class="lampd"></i>Station orders</span><div class="list"></div></section>
      <div id="hint"></div>
      <nav id="bar" class="pnl dark box"></nav>
      <div id="help"><span><kbd>1</kbd>–<kbd>6</kbd> build</span><span><kbd>R</kbd> rotate</span><span><kbd>Q</kbd> copy</span><span><kbd>RMB</kbd> remove</span><span><kbd>Drag</kbd> pan</span></div>
      <div id="tip"></div>
      <div id="burst"></div>`;
    (scene.game.canvas.parentElement ?? document.body).appendChild(this.root);
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.site = $('#site');
    this.creditsBox = $('#credits');
    this.credits = $('#credits b');
    this.flyers = $('#flyers');
    this.sites = $('#sites');
    this.route = $('#sites .route');
    this.bar = $('#bar');
    this.hint = $('#hint');
    this.tip = $('#tip');
    this.panel = $('#panel');
    this.orders = $('#orders');
    this.orderList = $('#orders .list');
    this.burst = $('#burst');
    this.alertsBox = $('#alerts');
    this.shownCredits = this.lastCredits = Math.floor(scene.campaign.credits);
    this.credits.textContent = this.fmt(this.shownCredits);
    this.buildToolbar();
    this.burst.onclick = () => this.endBurst();
  }

  /** Frames and paper tiles, painted once and handed to the stylesheet as custom properties. */
  private paintArt() {
    const s = this.root.style;
    const url = (u: string) => `url(${u})`;
    s.setProperty('--fr-paper', url(frame({ fill: '#f1dfb8', shade: '#c9a263', hi: '#fff6dc', shadow: true, rivets: true, seed: 5 })));
    s.setProperty('--fr-dark', url(frame({ fill: '#2c2030', shade: '#1d1420', hi: '#5a4862', shadow: true, rivets: true, seed: 9 })));
    s.setProperty('--fr-hz', url(frame({ fill: '#f6bd2c', shade: '#d98d12', hi: '#ffe48e', shadow: true, cut: 8, seed: 13 })));
    const slot = { slice: 16, cut: 6, stroke: 2.5, solid: true };
    s.setProperty('--fr-slot', url(frame({ ...slot, fill: '#e4c992', shade: '#b8955a', hi: '#fff3d0', seed: 21 })));
    s.setProperty('--fr-slot-hi', url(frame({ ...slot, fill: '#f3dca6', shade: '#c9a464', hi: '#fffbe8', seed: 21 })));
    s.setProperty('--fr-slot-on', url(frame({ ...slot, fill: '#f6bd2c', shade: '#d98d12', hi: '#ffe48e', seed: 21 })));
    s.setProperty('--grime-paper', url(grime('#f1dfb8', 3)));
    s.setProperty('--grime-dark', url(grime('#2c2030', 4)));
    s.setProperty('--grime-hz', url(grime('#f6bd2c', 6)));
  }

  private icon(key: string): string {
    let url = this.icons.get(key);
    if (url === undefined) {
      url = '';
      if (this.scene.textures.exists(key)) {
        const src = this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
        url = typeof src.toDataURL === 'function' ? src.toDataURL() : '';
      }
      this.icons.set(key, url);
    }
    return url;
  }

  private machineIcon(kind: BuildingKind): string {
    return this.icon(kind === 'belt' ? 'belt-icon' : kind === 'inserter' ? 'inserter-icon' : kind);
  }

  private fmt(n: number): string {
    return Math.floor(n).toLocaleString('en-US');
  }

  // ---------- tooltip ----------

  private bindTip(el: HTMLElement, html: () => string) {
    el.addEventListener('mouseenter', () => {
      this.tip.innerHTML = html();
      this.tip.classList.add('show');
      const r = el.getBoundingClientRect();
      const host = this.root.getBoundingClientRect();
      const t = this.tip.getBoundingClientRect();
      const below = r.top - host.top < host.height / 2;
      let x = r.left - host.left + r.width / 2 - t.width / 2;
      x = Math.max(8, Math.min(host.width - t.width - 8, x));
      // Above the toolbar, clear the placement hint when it is up.
      const hint = this.hint.classList.contains('show') && this.bar.contains(el) ? this.hint.getBoundingClientRect() : null;
      const top = hint ? Math.min(r.top, hint.top) : r.top;
      const y = below ? r.bottom - host.top + 12 : top - host.top - t.height - 10;
      this.tip.style.left = `${x}px`;
      this.tip.style.top = `${y}px`;
    });
    el.addEventListener('mouseleave', () => this.tip.classList.remove('show'));
  }

  // ---------- toolbar ----------

  private buildToolbar() {
    this.bar.innerHTML = '';
    BUILD_ORDER.forEach((kind, i) => {
      const def = BUILDINGS[kind];
      const s = document.createElement('button');
      s.className = 'tool';
      s.dataset.kind = kind;
      s.innerHTML = `<span class="key">${i + 1}</span><img src="${this.machineIcon(kind)}" alt=""><span class="cost">${def.cost}</span>`;
      s.onclick = () => this.pickSlot(i);
      this.bindTip(
        s,
        () =>
          `<h2>${def.name}</h2><p>${TOOL_TIPS[kind]}</p><div class="meta"><span>Key ${i + 1}</span><span>Parts cost ${def.cost}</span>${def.rotatable ? '<span>R rotates</span>' : ''}</div>`,
      );
      this.bar.appendChild(s);
    });
  }

  pickSlot(i: number) {
    const kind = BUILD_ORDER[i];
    if (!kind) return;
    this.scene.setTool(this.scene.tool === kind ? null : kind);
  }

  refreshToolbar() {
    const tool = this.scene.tool;
    for (const el of this.bar.children) (el as HTMLElement).classList.toggle('on', (el as HTMLElement).dataset.kind === tool);
    if (tool) {
      const def = BUILDINGS[tool];
      this.hint.innerHTML = `<b>${def.name}</b>${def.rotatable ? '<span><kbd>R</kbd>rotate</span>' : ''}<span><kbd>LMB</kbd>${tool === 'belt' ? 'drag to lay' : 'place'}</span><span><kbd>RMB</kbd>cancel</span>`;
      this.hint.classList.add('show');
    } else this.hint.classList.remove('show');
  }

  // ---------- planet route ----------

  refreshSites() {
    const c = this.scene.campaign;
    this.fresh.delete(c.current);
    this.route.innerHTML = '';
    c.levels.forEach((l, i) => {
      if (i > 0) {
        const link = document.createElement('span');
        link.className = 'link' + (c.automated.has(c.levels[i - 1].id) ? ' on' : '');
        this.route.appendChild(link);
      }
      const b = document.createElement('button');
      const locked = !c.isUnlocked(l.id);
      const done = c.automated.has(l.id);
      b.className = [l.id === c.current ? 'on' : '', done ? 'done' : '', locked ? 'locked' : '', this.fresh.has(l.id) ? 'fresh' : ''].join(' ');
      b.innerHTML =
        `<img src="${this.icon(`icon-${l.product}`)}" alt="">` + (locked ? `<span class="lk">${GLYPH.lock}</span>` : '') + (done ? `<span class="ck">${GLYPH.check}</span>` : '');
      b.onclick = () => {
        if (!locked) this.scene.showSite(l.id);
      };
      this.bindTip(b, () => {
        const state = locked ? 'Locked · automate the site before it' : done ? 'Automated · ships on its own' : l.id === c.current ? 'You are here' : 'Open';
        return `<h2>${i + 1}. ${l.name}</h2><p>Product: ${ITEMS[l.product].name} · goal ${l.target}/min</p><div class="meta"><span>${state}</span></div>`;
      });
      this.route.appendChild(b);
    });
    this.tip.classList.remove('show');
    this.siteKey = '';
    this.lastSite = 0;
  }

  blocksPointer(p: Phaser.Input.Pointer): boolean {
    const target = (p.event as MouseEvent | undefined)?.target as HTMLElement | undefined;
    return !!target && target.closest('#hud .box') !== null;
  }

  // ---------- celebration ----------

  onAutomated(site: string, next: string | null) {
    const c = this.scene.campaign;
    const l = c.level(site);
    if (next) this.fresh.add(next);
    for (const t of this.burstTimers) window.clearTimeout(t);
    const nl = next ? c.level(next) : null;
    const bits: string[] = [];
    const colors = ['#f6bd2c', '#8fd14a', '#e2513a', '#4fd1bd', '#f1dfb8', '#a46bd0'];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + Math.random() * 0.3;
      const d = 170 + Math.random() * 230;
      const vars = `--x:${(Math.cos(a) * d * 1.3).toFixed(0)}px;--y:${(Math.sin(a) * d * 0.75 - 40).toFixed(0)}px;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;--d:${(Math.random() * 0.25).toFixed(2)}s`;
      bits.push(
        i % 3 === 0
          ? `<span style="${vars}"><img src="${this.icon(`icon-${l.product}`)}" alt="" style="width:100%;height:100%"></span>`
          : `<span class="chip" style="${vars};--c:${colors[i % colors.length]}"></span>`,
      );
    }
    this.burst.innerHTML = `
      <div class="flash"></div><div class="rays"></div>
      <div class="card">
        <div class="boom">${starburst(site.length * 7 + 3)}</div>
        <div class="core">
          <div class="sock prod"><img src="${this.icon(`icon-${l.product}`)}" alt=""></div>
          <svg class="title" viewBox="0 0 600 110">
            <defs><linearGradient id="hb-cel" x1="0" y1="0" x2="0" y2="1"><stop offset=".56" stop-color="#ffffff"/><stop offset=".56" stop-color="#ffe9a8"/></linearGradient></defs>
            <text x="306" y="96" text-anchor="middle" font-family="Bangers, Impact, sans-serif" font-size="104" letter-spacing="3" fill="#1a1214">AUTOMATED!</text>
            <text x="300" y="90" text-anchor="middle" font-family="Bangers, Impact, sans-serif" font-size="104" letter-spacing="3" fill="url(#hb-cel)" stroke="#1a1214" stroke-width="10" paint-order="stroke" stroke-linejoin="round">AUTOMATED!</text>
          </svg>
          <div class="sub">${l.name} ships ${ITEMS[l.product].name.toLowerCase()}s on its own</div>
          ${nl ? `<div class="unlock"><span class="nw">New site</span><div class="sock"><img src="${this.icon(`icon-${nl.product}`)}" alt=""></div><div><b>${nl.name}</b>unlocked on the planet route</div></div>` : ''}
        </div>
      </div>
      <div class="bits">${bits.join('')}</div>`;
    this.burst.classList.remove('out');
    this.burst.classList.add('show');
    this.site.classList.remove('celebrate');
    void this.site.offsetWidth;
    this.site.classList.add('celebrate');
    this.burstTimers = [window.setTimeout(() => this.endBurst(), 3900)];
    this.refreshSites();
  }

  private endBurst() {
    if (!this.burst.classList.contains('show')) return;
    for (const t of this.burstTimers) window.clearTimeout(t);
    this.burst.classList.add('out');
    this.burstTimers = [window.setTimeout(() => this.burst.classList.remove('show', 'out'), 360)];
  }

  // ---------- site card ----------

  private buildSite() {
    const c = this.scene.campaign;
    const l = c.level(c.current);
    const idx = c.levels.indexOf(l);
    const notch = (100 / METER_SPAN).toFixed(2);
    this.site.innerHTML = `
      <span class="tag">Site ${idx + 1} of ${c.levels.length}</span>
      <h1>${l.name}</h1>
      <div class="blurb">${l.blurb}</div>
      <div class="goal">
        <div class="sock"><img src="${this.icon(`icon-${l.product}`)}" alt=""></div>
        <div class="gname"><span class="lbl">Ship to station</span><b>${ITEMS[l.product].name}</b></div>
        <div class="stamp"></div>
      </div>
      <div class="meter"><i class="fill"></i><i class="notch" style="left:${notch}%"></i></div>
      <div class="row"><span class="rate"><b class="num">0.0</b> <span>/ ${l.target} per min</span></span><span class="cost">${GLYPH.wrench}<b>0</b>&nbsp;parts</span></div>`;
  }

  private renderSite() {
    const c = this.scene.campaign;
    const key = `${c.current}|${c.levels.length}`;
    if (key !== this.siteKey) {
      this.buildSite();
      this.siteKey = key;
      this.shipped = -1;
    }
    const w = c.world;
    const l = c.level(c.current);
    const rate = w.rate();
    const done = c.automated.has(l.id);
    const meetsGoal = rate >= l.target;
    const fill = Math.min(100, (rate / (l.target * METER_SPAN)) * 100);
    const q = <T extends HTMLElement>(s: string) => this.site.querySelector(s) as T;
    const stamp = q('.stamp');
    const stampText = done ? 'Automated' : 'Goal';
    if (stamp.textContent !== stampText) {
      stamp.textContent = stampText;
      stamp.className = `stamp ${done ? 'done' : 'goal-s'}`;
    }
    q('.meter').classList.toggle('done', meetsGoal);
    // Each shipment that reaches the elevator kicks the meter, in step with the gauge on the pad.
    const shipped = w.exportedTotal[l.product] ?? 0;
    if (this.shipped >= 0 && shipped > this.shipped) {
      const m = q('.meter');
      m.classList.remove('kick');
      void m.offsetWidth;
      m.classList.add('kick');
    }
    this.shipped = shipped;
    q('.fill').style.width = `${fill.toFixed(1)}%`;
    q('.rate').classList.toggle('done', meetsGoal);
    q('.rate b').textContent = rate.toFixed(1);
    q('.cost b').textContent = String(w.cost());
  }

  // ---------- trouble strip ----------

  /** Stuck machines grouped by problem, worst first; a click jumps to the next one in the group. */
  private renderAlerts() {
    const groups = new Map<string, { d: Diagnosis; kind: BuildingKind; ids: number[] }>();
    for (const { e, d } of this.scene.status.alerts()) {
      const k = `${d.kind}|${d.item ?? ''}|${e.kind}`;
      const g = groups.get(k);
      if (g) g.ids.push(e.id);
      else groups.set(k, { d, kind: e.kind, ids: [e.id] });
    }
    const all = [...groups.entries()];
    const list = all.slice(0, 3);
    const more = all.slice(3).reduce((n, [, g]) => n + g.ids.length, 0);
    const sig = list.map(([k, g]) => `${k}:${g.ids.join(',')}`).join(';') + `+${more}`;
    // Sit right under the site card.
    const top = this.site.offsetTop + this.site.offsetHeight + 8;
    if (this.alertsBox.style.top !== `${top}px`) this.alertsBox.style.top = `${top}px`;
    if (sig === this.alertsSig) return;
    this.alertsSig = sig;
    this.alertsBox.innerHTML = '';
    for (const [k, g] of list) {
      const look = statusLook(g.d, g.kind);
      if (!look) continue;
      const b = document.createElement('button');
      b.className = look.plate;
      const item = look.glyph || !g.d.item ? this.icon(`st-glyph-${look.glyph ?? 'ore'}`) : this.icon(`icon-${g.d.item}`);
      b.innerHTML = `<span class="sg"><img class="pl" src="${this.icon(`st-plate-${look.plate}`)}" alt=""><img class="it" src="${item}" alt=""></span><span class="what">${look.caption}<small>${BUILDINGS[g.kind].name}${g.d.item && !look.glyph ? ` · ${ITEMS[g.d.item].name}` : ''}</small></span>${g.ids.length > 1 ? `<span class="n">×${g.ids.length}</span>` : ''}`;
      b.title = g.d.text;
      b.onclick = () => {
        const i = ((this.alertTurn.get(k) ?? -1) + 1) % g.ids.length;
        this.alertTurn.set(k, i);
        const e = this.scene.world.entities.get(g.ids[i]);
        if (e) this.scene.focus(e);
      };
      this.alertsBox.appendChild(b);
    }
    if (more) {
      const m = document.createElement('span');
      m.className = 'more';
      m.textContent = `+${more} more stuck`;
      this.alertsBox.appendChild(m);
    }
  }

  // ---------- credits ----------

  private updateCredits(time: number) {
    const target = Math.floor(this.scene.campaign.credits);
    if (target < this.lastCredits) {
      // Save loaded: snap, no fanfare.
      this.shownCredits = this.lastCredits = target;
      this.credits.textContent = this.fmt(target);
      return;
    }
    this.pendingGain += target - this.lastCredits;
    this.lastCredits = target;
    if (target > this.shownCredits) {
      this.shownCredits = Math.min(target, this.shownCredits + Math.max(1, (target - this.shownCredits) * 0.18));
      this.credits.textContent = this.fmt(this.shownCredits);
    }
    if (this.pendingGain > 0 && time - this.lastFlyer > 650) {
      const f = document.createElement('span');
      f.textContent = `+${this.fmt(this.pendingGain)}`;
      f.onanimationend = () => f.remove();
      this.flyers.appendChild(f);
      this.pendingGain = 0;
      this.lastFlyer = time;
      this.creditsBox.classList.add('pop');
      window.clearTimeout(this.popTimer);
      this.popTimer = window.setTimeout(() => this.creditsBox.classList.remove('pop'), 220);
    }
  }

  // ---------- inspector ----------

  showEntity(e: Entity | null) {
    this.panel.classList.toggle('show', !!e);
    this.panelSig = '';
    this.lastPanel = 0;
  }

  private slot(item: ItemId | null, v: string | null, opts: { need?: number; label?: string; placeholder?: ItemId } = {}): string {
    const shown = item ?? opts.placeholder;
    const img = shown ? `<img src="${this.icon(`icon-${shown}`)}" alt="">` : '';
    return `<div class="slot${item ? '' : ' empty'}"><div class="sock">${img}</div>${opts.need ? `<i>×${opts.need}</i>` : ''}${v ? `<b data-v="${v}">0</b>` : ''}${opts.label ? `<small>${opts.label}</small>` : ''}</div>`;
  }

  private status(cls: 'ok' | 'warn' | 'bad' | 'idle', text: string): string {
    return `<span class="lamp ${cls}"></span><span>${text}</span>`;
  }

  /** Structure (rebuilt only when `sig` changes) plus the live values patched into it. */
  private panelModel(e: Entity): { sig: string; html: string; vals: Record<string, string>; bars: Record<string, number>; status: string; want: string | null; bad: boolean } {
    const w = this.scene.world;
    const vals: Record<string, string> = {};
    const bars: Record<string, number> = {};
    let sig: string = e.kind;
    let html = '';
    switch (e.kind) {
      case 'furnace': {
        const out = e.output ?? e.recipe?.output ?? null;
        sig += `|${e.input}|${out}`;
        html = `<div class="flow lbls">${this.slot(e.input, 'in', { label: 'ore', placeholder: 'ferrite-ore' })}<span class="op">${GLYPH.plus}</span>${this.slot('carbon', 'fuel', { label: 'fuel' })}<span class="to">${GLYPH.arrow}</span>${this.slot(out, 'out', { label: 'bars', placeholder: 'ferrite-bar' })}</div><div class="prog"><i data-b="p"></i></div>`;
        vals.in = String(e.inputCount);
        vals.fuel = String(e.fuel);
        vals.out = String(e.outputCount);
        bars.p = e.progress;
        break;
      }
      case 'assembler': {
        const r = e.recipe;
        sig += `|${r?.id}`;
        html = '<div class="recipes">';
        for (const rc of ASSEMBLY)
          html += `<button data-r="${rc.id}" class="${r?.id === rc.id ? 'on' : ''}"><img src="${this.icon(`icon-${rc.output}`)}" alt="">${ITEMS[rc.output].name}</button>`;
        html += '</div>';
        if (r) {
          html += '<div class="flow">';
          const ins = Object.entries(r.inputs) as [ItemId, number][];
          ins.forEach(([k, n], i) => {
            if (i) html += `<span class="op">${GLYPH.plus}</span>`;
            html += this.slot(k, `in-${k}`, { need: n });
            vals[`in-${k}`] = String(e.inputs[k] ?? 0);
          });
          html += `<span class="to">${GLYPH.arrow}</span>${this.slot(r.output, 'out', { need: r.count > 1 ? r.count : undefined })}</div><div class="prog"><i data-b="p"></i></div>`;
          vals.out = String(e.outputCount);
          bars.p = e.progress;
        }
        break;
      }
      case 'miner': {
        let ore: ItemId | null = null;
        let left = 0;
        for (let j = 0; j < e.size; j++)
          for (let i = 0; i < e.size; i++) {
            const o = w.ore[w.idx(e.x + i, e.y + j)];
            if (o) {
              ore ??= o.type;
              left += o.amount;
            }
          }
        sig += `|${ore}`;
        html = `<div class="flow">${this.slot(ore, null)}<div class="big"><b data-v="left">0</b><span class="lbl">ore left</span></div></div><div class="prog"><i data-b="p"></i></div>`;
        vals.left = this.fmt(left);
        bars.p = e.progress;
        break;
      }
      case 'elevator': {
        const l = this.scene.campaign.level(this.scene.campaign.current);
        html = `<div class="flow">${this.slot(l.product, 'sent')}<div class="big"><b data-v="rate">0</b><span class="lbl">per min to orbit</span></div></div>`;
        vals.sent = this.fmt(e.received);
        vals.rate = w.rate().toFixed(1);
        break;
      }
      case 'importer':
        sig += `|${e.item}`;
        html = `<div class="flow">${this.slot(e.item, 'n')}<div class="big"><b>${e.perMinute}</b><span class="lbl">per min</span></div></div>`;
        vals.n = e.out ? '1' : '0';
        break;
      case 'chest': {
        const items = (Object.entries(e.items) as [ItemId, number][]).filter(([, n]) => n > 0);
        sig += `|${items.map(([k]) => k).join(',')}`;
        html = items.length ? `<div class="grid">${items.map(([k]) => this.slot(k, `c-${k}`)).join('')}</div>` : '<div class="note">Empty. Grabbers fill and empty crates.</div>';
        for (const [k, n] of items) vals[`c-${k}`] = String(n);
        break;
      }
      case 'belt': {
        const counts: Partial<Record<ItemId, number>> = {};
        for (const it of e.items) counts[it.item] = (counts[it.item] ?? 0) + 1;
        const keys = Object.keys(counts) as ItemId[];
        sig += `|${keys.join(',')}`;
        html = keys.length ? `<div class="grid">${keys.map((k) => this.slot(k, `b-${k}`)).join('')}</div>` : '<div class="note">Nothing on this stretch.</div>';
        for (const k of keys) vals[`b-${k}`] = String(counts[k]);
        break;
      }
      case 'inserter':
        sig += `|${e.held}`;
        html = `<div class="flow">${this.slot(e.held, 'h')}<div class="note">${e.held ? 'In the claw' : 'Claw empty'}</div></div>`;
        vals.h = e.held ? '1' : '0';
        break;
    }
    const d = diagnose(w, e);
    const status = this.status(d.severity, d.text);
    // The slot behind the problem, flagged in the flow diagram.
    const want =
      d.kind === 'no-fuel' ? 'fuel'
      : d.kind === 'output-full' || d.kind === 'backed-up' ? (e.kind === 'furnace' || e.kind === 'assembler' ? 'out' : null)
      : d.kind === 'no-input' ? (e.kind === 'furnace' ? 'in' : e.kind === 'assembler' && d.item ? `in-${d.item}` : null)
      : null;
    return { sig, html, vals, bars, status, want, bad: d.severity === 'bad' };
  }

  private renderPanel(e: Entity) {
    const def = BUILDINGS[e.kind];
    const m = this.panelModel(e);
    const sig = `${e.id}|${m.sig}`;
    if (sig !== this.panelSig) {
      const foot = def.fixed
        ? `<div class="foot">${GLYPH.bolt}Part of the site</div>`
        : `<div class="foot">${GLYPH.wrench}Parts cost ${def.cost}<span><kbd>RMB</kbd>remove</span></div>`;
      this.panel.innerHTML = `
        <span class="tag">Inspector</span>
        <header><div class="mi"><img src="${this.machineIcon(e.kind)}" alt=""></div><h2>${def.name}</h2><button class="x" title="Close">${GLYPH.close}</button></header>
        <div class="status"></div>${m.html}${foot}`;
      this.panel.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => {
        b.onclick = () => {
          this.scene.world.setRecipe(e.x, e.y, b.dataset.r!);
          this.lastPanel = 0;
        };
      });
      (this.panel.querySelector('.x') as HTMLButtonElement).onclick = () => this.scene.select(null);
      this.panelSig = sig;
    }
    const st = this.panel.querySelector('.status') as HTMLElement;
    if (st.innerHTML !== m.status) st.innerHTML = m.status;
    this.panel.querySelectorAll('.slot').forEach((el) => {
      const v = el.querySelector('b[data-v]')?.getAttribute('data-v');
      el.classList.toggle('want', !!v && v === m.want);
      el.classList.toggle('bad', !!v && v === m.want && m.bad);
    });
    for (const [k, v] of Object.entries(m.vals)) {
      const el = this.panel.querySelector(`[data-v="${k}"]`);
      if (!el) continue;
      el.textContent = v;
      el.classList.toggle('full', k === 'out' && Number(v) >= MACHINE_BUFFER);
    }
    for (const [k, v] of Object.entries(m.bars)) {
      const el = this.panel.querySelector(`[data-b="${k}"]`) as HTMLElement | null;
      if (el) el.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
    }
  }

  // ---------- station orders ----------

  private renderOrders() {
    const c = this.scene.campaign;
    if (c !== this.ordersCampaign) {
      this.orderList.innerHTML = '';
      this.orderViews.clear();
      this.ordersCampaign = c;
    }
    const live = new Set<string>();
    for (const o of c.orders) {
      live.add(o.id);
      let v = this.orderViews.get(o.id);
      if (!v) {
        const el = document.createElement('div');
        el.className = 'ord new';
        el.innerHTML = `<div class="sock"><img src="${this.icon(`icon-${o.item}`)}" alt=""></div><div class="nm">${ITEMS[o.item].name} <em>×${o.quantity}</em></div><div class="rew">${GLYPH.coin}+${this.fmt(o.reward)}</div><div class="ob"><div class="prog"><i></i></div><small></small></div><div class="paidst">Paid +${this.fmt(o.reward)}</div>`;
        this.orderList.appendChild(el);
        v = { el, bar: el.querySelector('.prog i') as HTMLElement, count: el.querySelector('.ob small') as HTMLElement };
        this.orderViews.set(o.id, v);
      }
      v.bar.style.width = `${((o.delivered / o.quantity) * 100).toFixed(1)}%`;
      v.count.textContent = `${o.delivered}/${o.quantity}`;
    }
    for (const [id, v] of this.orderViews) {
      if (live.has(id)) continue;
      // Delivered: fill the bar, stamp it paid, then let it slide away.
      this.orderViews.delete(id);
      v.bar.style.width = '100%';
      v.el.classList.remove('new');
      v.el.classList.add('paid');
      window.setTimeout(() => v.el.remove(), 1500);
    }
    this.orders.classList.toggle('show', this.orderList.childElementCount > 0);
  }

  update(time: number) {
    this.updateCredits(time);
    if (time - this.lastSite > 250) {
      this.renderSite();
      this.renderAlerts();
      this.renderOrders();
      this.lastSite = time;
    }
    const e = this.scene.selected;
    if (e && time - this.lastPanel > 200) {
      this.renderPanel(e);
      this.lastPanel = time;
    }
  }
}
