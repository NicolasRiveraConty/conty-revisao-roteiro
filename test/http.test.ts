import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/http/app.js";
import type { ProximaAcao, RoteiroVisao } from "../src/dominio/roteiro.js";

const AGORA = new Date("2026-10-07T12:00:00.000Z");
const PRAZO = "2026-10-15T18:00:00.000Z";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function subir(): FastifyInstance {
  app = criarApp({ agora: () => AGORA });
  return app;
}

async function abrirRevisao(instancia: FastifyInstance, conteudo = "Versão 1: produto na mesa, sem cupom."): Promise<RoteiroVisao> {
  const resposta = await instancia.inject({
    method: "POST",
    url: "/roteiros",
    payload: { campanhaId: "cmp_outubro", conteudo },
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json();
}

function opcao(proxima: ProximaAcao, acao: ProximaAcao["opcoes"][number]["acao"]) {
  const encontrada = proxima.opcoes.find((item) => item.acao === acao);
  expect(encontrada, `opção ${acao}`).toBeDefined();
  if (!encontrada) throw new Error(`sem opção ${acao}`);
  return encontrada;
}

describe("HTTP da revisão", () => {
  it("percorre o fluxo inteiro seguindo a próxima ação devolvida pela API", async () => {
    const instancia = subir();
    const criado = await abrirRevisao(instancia);

    expect(criado.status).toBe("aguardando_marca");
    expect(criado.proximaAcao.ator).toBe("marca");
    expect(criado.proximaAcao.opcoes.map((item) => item.acao)).toEqual(["pedir_alteracao", "aprovar"]);

    const pedir = opcao(criado.proximaAcao, "pedir_alteracao");

    const semMotivo = await instancia.inject({
      method: pedir.metodo,
      url: pedir.caminho,
      payload: { prazo: PRAZO },
    });
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json()).toMatchObject({
      erro: "validacao",
      campos: { motivo: expect.any(String) },
    });

    const semPrazo = await instancia.inject({
      method: pedir.metodo,
      url: pedir.caminho,
      payload: { motivo: "Citar o cupom de outubro." },
    });
    expect(semPrazo.statusCode).toBe(400);
    expect(semPrazo.json()).toMatchObject({
      erro: "validacao",
      campos: { prazo: expect.any(String) },
    });

    const pedido = await instancia.inject({
      method: pedir.metodo,
      url: pedir.caminho,
      payload: { motivo: "Citar o cupom de outubro no CTA.", prazo: PRAZO },
    });
    expect(pedido.statusCode).toBe(200);
    const aguardandoCriador: RoteiroVisao = pedido.json();
    expect(aguardandoCriador.status).toBe("aguardando_criador");
    expect(aguardandoCriador.versaoAtual.pedidoAlteracao).toMatchObject({
      motivo: "Citar o cupom de outubro no CTA.",
      prazo: PRAZO,
    });
    expect(aguardandoCriador.proximaAcao.ator).toBe("criador");

    const aprovarCedo = opcao(criado.proximaAcao, "aprovar");
    const cedo = await instancia.inject({ method: aprovarCedo.metodo, url: aprovarCedo.caminho });
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json()).toMatchObject({
      erro: "transicao_invalida",
      status: "aguardando_criador",
      proximaAcao: { ator: "criador" },
    });

    const enviar = opcao(aguardandoCriador.proximaAcao, "enviar_versao");
    const nova = await instancia.inject({
      method: enviar.metodo,
      url: enviar.caminho,
      payload: { conteudo: "Versão 2: CTA com o cupom OUTUBRO." },
    });
    expect(nova.statusCode).toBe(201);
    const emAnalise: RoteiroVisao = nova.json();
    expect(emAnalise.status).toBe("aguardando_marca");
    expect(emAnalise.versoes).toHaveLength(2);
    expect(emAnalise.versoes[0]).toMatchObject({
      numero: 1,
      conteudo: "Versão 1: produto na mesa, sem cupom.",
      status: "alteracao_pedida",
    });
    expect(emAnalise.versaoAtual).toMatchObject({ numero: 2, status: "em_analise" });

    const aprovar = opcao(emAnalise.proximaAcao, "aprovar");
    const fim = await instancia.inject({ method: aprovar.metodo, url: aprovar.caminho });
    expect(fim.statusCode).toBe(200);
    const aprovado: RoteiroVisao = fim.json();
    expect(aprovado.status).toBe("aprovado");
    expect(aprovado.versaoAtual.status).toBe("aprovada");
    expect(aprovado.proximaAcao.opcoes).toEqual([]);

    const consulta = await instancia.inject({ method: "GET", url: `/roteiros/${aprovado.id}` });
    expect(consulta.statusCode).toBe(200);
    const historico: RoteiroVisao = consulta.json();
    expect(historico.versoes.map((versao) => versao.conteudo)).toEqual([
      "Versão 1: produto na mesa, sem cupom.",
      "Versão 2: CTA com o cupom OUTUBRO.",
    ]);
    expect(historico.versoes[0]?.pedidoAlteracao?.motivo).toBe("Citar o cupom de outubro no CTA.");

    for (const caminho of [
      `/roteiros/${aprovado.id}/pedidos-alteracao`,
      `/roteiros/${aprovado.id}/versoes`,
      `/roteiros/${aprovado.id}/aprovacao`,
    ]) {
      const bloqueado = await instancia.inject({
        method: "POST",
        url: caminho,
        payload: { motivo: "Tarde demais.", prazo: PRAZO, conteudo: "Versão 3." },
      });
      expect(bloqueado.statusCode, caminho).toBe(409);
      expect(bloqueado.json()).toMatchObject({ erro: "transicao_invalida", status: "aprovado" });
    }
  });

  it("recusa prazo no passado com 400 e deixa o roteiro aguardando a marca", async () => {
    const instancia = subir();
    const criado = await abrirRevisao(instancia);
    const pedir = opcao(criado.proximaAcao, "pedir_alteracao");

    const resposta = await instancia.inject({
      method: pedir.metodo,
      url: pedir.caminho,
      payload: { motivo: "Trocar a abertura.", prazo: "2026-10-01T18:00:00.000Z" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().campos.prazo).toMatch(/posterior/);

    const consulta = await instancia.inject({ method: "GET", url: `/roteiros/${criado.id}` });
    expect(consulta.json()).toMatchObject({ status: "aguardando_marca" });
  });

  it("responde 404 para um roteiro que não existe", async () => {
    const instancia = subir();
    const resposta = await instancia.inject({ method: "GET", url: "/roteiros/rot_inexistente" });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ erro: "nao_encontrado", id: "rot_inexistente" });
  });

  it("recusa abrir revisão sem conteúdo", async () => {
    const instancia = subir();
    const resposta = await instancia.inject({
      method: "POST",
      url: "/roteiros",
      payload: { campanhaId: "cmp_outubro", conteudo: "   " },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({
      erro: "validacao",
      campos: { conteudo: expect.any(String) },
    });
  });
});
