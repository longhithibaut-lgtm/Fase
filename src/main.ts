import Phaser from 'phaser';
import { ShopBridge } from './bridge/shopBridge';
import { FactoryScene } from './render/FactoryScene';
import { buildStarter } from './sim/scenarios';
import { World } from './sim/world';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1337);

function newWorld(): World {
  const w = new World(96, 96, seed);
  if (!params.has('empty')) buildStarter(w);
  return w;
}

const scene = new FactoryScene(newWorld);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#101010',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  render: { antialias: true, preserveDrawingBuffer: true },
  scene,
});

const bridge = new ShopBridge(
  () => scene.world,
  (msg) => scene.setWorld(World.load(msg.save)),
);

scene.afterUpdate = () => bridge.update(performance.now());

// Exposed for automated tests and the dev harness.
(window as unknown as { __factory: unknown }).__factory = { game, scene, bridge };
