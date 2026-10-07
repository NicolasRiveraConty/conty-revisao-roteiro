import { criarApp } from "./http/app.js";

const porta = Number(process.env.PORT ?? 3000);
const app = criarApp({ logger: true });

app.listen({ port: porta, host: "0.0.0.0" }).catch((erro: unknown) => {
  app.log.error(erro);
  process.exit(1);
});
