import { Game } from './core/Game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const game = new Game(document.getElementById('app'), document.getElementById('ui'));
if (!webglAvailable()) {
  game.ui.fatal('WILDLANDS needs WebGL, which this browser or device does not seem to support.');
} else {
  game.init().catch((err) => {
    console.error(err);
    game.ui.fatal(`The island failed to load: ${err.message}`);
  });
}
