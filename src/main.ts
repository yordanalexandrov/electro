import { App } from './app';

const app = new App();
// handy for poking at the state from the console
(window as unknown as { app: App }).app = app;
