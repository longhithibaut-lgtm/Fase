import Phaser from 'phaser';
import { ShopBridge } from './bridge/shopBridge';
import { FactoryScene } from './render/FactoryScene';
import { Campaign } from './sim/campaign';
import { buildDemo } from './sim/demos';

let campaign = new Campaign();
const params = new URLSearchParams(location.search);
const site = params.get('site');
if (site) {
  // Dev shortcut: ?site=<id> unlocks everything up to that site.
  for (const l of campaign.levels) {
    if (l.id === site) break;
    campaign.automated.add(l.id);
  }
  campaign.select(site);
}
// Dev shortcut: ?demo=1 builds the reference factory on the current site.
if (params.has('demo')) buildDemo(campaign.world, campaign.current);

const scene = new FactoryScene(() => campaign);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1230',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  render: { antialias: true, preserveDrawingBuffer: true },
  scene,
});

const bridge = new ShopBridge(
  () => campaign,
  (msg) => {
    campaign = Campaign.load(msg.save);
    scene.setCampaign(campaign);
  },
);

scene.afterUpdate = () => bridge.update(performance.now());

// Exposed for automated tests and the dev harness.
(window as unknown as { __factory: unknown }).__factory = {
  game,
  scene,
  bridge,
  get campaign() {
    return campaign;
  },
};
