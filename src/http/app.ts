import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ErroDominio,
  apresentar,
  aprovar,
  criarRoteiro,
  enviarVersao,
  pedirAlteracao,
  type DependenciasDominio,
  type Roteiro,
} from "../dominio/roteiro.js";
import { RepositorioMemoria, type RepositorioRoteiro } from "../repositorio/roteiro-repositorio.js";

const STATUS_HTTP = {
  validacao: 400,
  nao_encontrado: 404,
  transicao_invalida: 409,
} as const;

export type OpcoesApp = {
  repositorio?: RepositorioRoteiro;
  agora?: () => Date;
  novoId?: () => string;
  logger?: boolean;
};

export function criarApp(opcoes: OpcoesApp = {}): FastifyInstance {
  const repositorio = opcoes.repositorio ?? new RepositorioMemoria();
  const deps: DependenciasDominio = {
    agora: opcoes.agora ?? (() => new Date()),
    novoId: opcoes.novoId ?? (() => randomUUID()),
  };

  const app = Fastify({ logger: opcoes.logger ?? false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ErroDominio) {
      return reply.status(STATUS_HTTP[error.codigo]).send({
        erro: error.codigo,
        mensagem: error.message,
        ...error.detalhes,
      });
    }

    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        erro: "validacao",
        mensagem: "Não foi possível ler a requisição.",
      });
    }

    app.log.error(error);
    return reply.status(500).send({ erro: "interno", mensagem: "Erro interno." });
  });

  app.post("/roteiros", async (request, reply) => {
    const corpo = comoObjeto(request.body);
    const roteiro = criarRoteiro(
      { campanhaId: corpo.campanhaId, conteudo: corpo.conteudo },
      deps,
    );
    await repositorio.salvar(roteiro);
    return reply.status(201).send(apresentar(roteiro));
  });

  app.get("/roteiros/:id", async (request) => {
    const roteiro = await carregar(repositorio, idDe(request.params));
    return apresentar(roteiro);
  });

  app.post("/roteiros/:id/pedidos-alteracao", async (request) => {
    const atual = await carregar(repositorio, idDe(request.params));
    const corpo = comoObjeto(request.body);
    const roteiro = pedirAlteracao(atual, { motivo: corpo.motivo, prazo: corpo.prazo }, deps);
    await repositorio.salvar(roteiro);
    return apresentar(roteiro);
  });

  app.post("/roteiros/:id/versoes", async (request, reply) => {
    const atual = await carregar(repositorio, idDe(request.params));
    const corpo = comoObjeto(request.body);
    const roteiro = enviarVersao(atual, { conteudo: corpo.conteudo }, deps);
    await repositorio.salvar(roteiro);
    return reply.status(201).send(apresentar(roteiro));
  });

  app.post("/roteiros/:id/aprovacao", async (request) => {
    const atual = await carregar(repositorio, idDe(request.params));
    const roteiro = aprovar(atual, deps);
    await repositorio.salvar(roteiro);
    return apresentar(roteiro);
  });

  return app;
}

async function carregar(repositorio: RepositorioRoteiro, id: string): Promise<Roteiro> {
  const roteiro = await repositorio.buscarPorId(id);
  if (!roteiro) {
    throw new ErroDominio("nao_encontrado", "Roteiro não encontrado.", { id });
  }
  return roteiro;
}

function idDe(params: unknown): string {
  if (typeof params === "object" && params !== null && "id" in params) {
    const id = params.id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  throw new ErroDominio("validacao", "Informe o id do roteiro.");
}

function comoObjeto(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new ErroDominio("validacao", "O corpo precisa ser um objeto JSON.");
  }
  return body as Record<string, unknown>;
}
