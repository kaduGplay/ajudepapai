import app from './app.js';
import { config } from './config.js';
import { startWorker } from './orders.js';
startWorker();
app.listen(config.port, () => console.log(`Servidor PIX na porta ${config.port}`));
