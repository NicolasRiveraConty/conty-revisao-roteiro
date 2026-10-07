import { describe, expect, it } from "vitest";
import {
  ErroDominio,
  aprovar,
  criarRoteiro,
  enviarVersao,
  pedirAlteracao,
  type DependenciasDominio,
  type Roteiro,
  type StatusRoteiro,
} from "../src/dominio/roteiro.js";
import { RepositorioMemoria } from "../src/repositorio/roteiro-repositorio.js";

const PRAZO = "2026-10-10T18:00:00.000Z";
const AGORA = "2026-10-07T12:00:00.000Z";

function relogio(iso = AGORA): DependenciasDominio {
  let n = 0;
  return {
    agora: () => new Date(iso),
    novoId: () => String(++n),
  };
}

function abrir(deps = relogio(), conteudo = "Abertura com o produto na mesa."): Roteiro {
  return criarRoteiro({ campanhaId: "cmp_outubro", conteudo }, deps);
}

function noEstado(estado: StatusRoteiro, deps: DependenciasDominio): Roteiro {
  const roteiro = abrir(deps);
  if (estado === "aguardando_marca") return roteiro;
  if (estado === "aguardando_criador") {
    return pedirAlteracao(roteiro, { motivo: "O CTA não cita o cupom.", prazo: PRAZO }, deps);
  }
  return aprovar(roteiro, deps);
}

describe("máquina de estados do roteiro", () => {
  it("abre aguardando a marca, com a versão 1 em análise", () => {
    const roteiro = abrir();

    expect(roteiro.status).toBe("aguardando_marca");
    expect(roteiro.versoes).toHaveLength(1);
    expect(roteiro.versoes[0]).toMatchObject({
      numero: 1,
      status: "em_analise",
      conteudo: "Abertura com o produto na mesa.",
    });
  });

  it("grava motivo e prazo na versão e passa a aguardar o criador", () => {
    const deps = relogio();
    const roteiro = pedirAlteracao(
      abrir(deps),
      { motivo: "  O CTA final não cita o cupom de outubro.  ", prazo: PRAZO },
      deps,
    );

    expect(roteiro.status).toBe("aguardando_criador");
    expect(roteiro.versoes[0]).toMatchObject({
      status: "alteracao_pedida",
      pedidoAlteracao: {
        motivo: "O CTA final não cita o cupom de outubro.",
        prazo: PRAZO,
        solicitadoEm: AGORA,
      },
    });
  });

  it.each([
    [{ motivo: "   ", prazo: PRAZO }, ["motivo"]],
    [{ motivo: "Faltou o cupom.", prazo: undefined }, ["prazo"]],
    [{ motivo: "", prazo: "" }, ["motivo", "prazo"]],
    [{ motivo: "Faltou o cupom.", prazo: "semana que vem" }, ["prazo"]],
    [{ motivo: "Faltou o cupom.", prazo: "2026-02-31" }, ["prazo"]],
    [{ motivo: "Faltou o cupom.", prazo: "2026-10-01T00:00:00.000Z" }, ["prazo"]],
    [{ motivo: "Faltou o cupom.", prazo: AGORA }, ["prazo"]],
  ])("recusa pedido incompleto %j", (entrada, campos) => {
    const roteiro = abrir();

    expect(() => pedirAlteracao(roteiro, entrada, relogio())).toThrow(ErroDominio);
    try {
      pedirAlteracao(roteiro, entrada, relogio());
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      const dominio = erro as ErroDominio;
      expect(dominio.codigo).toBe("validacao");
      expect(Object.keys(dominio.detalhes.campos as object).sort()).toEqual([...campos].sort());
    }
    expect(roteiro.status).toBe("aguardando_marca");
    expect(roteiro.versoes[0]?.pedidoAlteracao).toBeUndefined();
  });

  it("trata data sem hora como o fim daquele dia em UTC", () => {
    const deps = relogio();
    const roteiro = pedirAlteracao(abrir(deps), { motivo: "Encurtar a abertura.", prazo: "2026-10-10" }, deps);

    expect(roteiro.versoes[0]?.pedidoAlteracao?.prazo).toBe("2026-10-10T23:59:59.999Z");
  });

  it("aprovar encerra a revisão na versão que estava em análise", () => {
    const deps = relogio();
    const roteiro = aprovar(abrir(deps), deps);

    expect(roteiro.status).toBe("aprovado");
    expect(roteiro.versoes[0]).toMatchObject({ status: "aprovada", aprovadaEm: AGORA });
  });

  it("mantém a versão antiga, com o pedido, quando chega outra", () => {
    const deps = relogio();
    const comPedido = pedirAlteracao(
      abrir(deps, "Versão 1, sem cupom."),
      { motivo: "Citar o cupom.", prazo: PRAZO },
      deps,
    );
    const primeira = comPedido.versoes[0];

    const comNova = enviarVersao(comPedido, { conteudo: "Versão 2, com o cupom OUTUBRO." }, deps);

    expect(comNova.status).toBe("aguardando_marca");
    expect(comNova.versoes).toHaveLength(2);
    expect(comNova.versoes[0]).toEqual(primeira);
    expect(comNova.versoes[1]).toMatchObject({
      numero: 2,
      status: "em_analise",
      conteudo: "Versão 2, com o cupom OUTUBRO.",
    });
  });

  it("preserva cada pedido ao longo de duas rodadas", () => {
    const deps = relogio();
    let roteiro = abrir(deps, "v1");
    roteiro = pedirAlteracao(roteiro, { motivo: "Primeiro ajuste.", prazo: PRAZO }, deps);
    roteiro = enviarVersao(roteiro, { conteudo: "v2" }, deps);
    roteiro = pedirAlteracao(roteiro, { motivo: "Segundo ajuste.", prazo: "2026-10-12T18:00:00.000Z" }, deps);
    roteiro = enviarVersao(roteiro, { conteudo: "v3" }, deps);

    expect(roteiro.versoes.map((versao) => versao.numero)).toEqual([1, 2, 3]);
    expect(roteiro.versoes[0]?.pedidoAlteracao?.motivo).toBe("Primeiro ajuste.");
    expect(roteiro.versoes[1]?.pedidoAlteracao?.motivo).toBe("Segundo ajuste.");
    expect(roteiro.versoes[2]).toMatchObject({ conteudo: "v3", status: "em_analise" });
    expect(roteiro.versoes[2]?.pedidoAlteracao).toBeUndefined();
  });

  it.each<[StatusRoteiro, "pedir_alteracao" | "aprovar" | "enviar_versao"]>([
    ["aguardando_marca", "enviar_versao"],
    ["aguardando_criador", "pedir_alteracao"],
    ["aguardando_criador", "aprovar"],
    ["aprovado", "pedir_alteracao"],
    ["aprovado", "aprovar"],
    ["aprovado", "enviar_versao"],
  ])("recusa %s ao tentar %s", (estado, acao) => {
    const deps = relogio();
    const roteiro = noEstado(estado, deps);
    const executar = () => {
      if (acao === "pedir_alteracao") {
        return pedirAlteracao(roteiro, { motivo: "Outro ajuste.", prazo: PRAZO }, deps);
      }
      if (acao === "aprovar") return aprovar(roteiro, deps);
      return enviarVersao(roteiro, { conteudo: "Tentativa fora de hora." }, deps);
    };

    expect(executar).toThrow(ErroDominio);
    try {
      executar();
    } catch (erro) {
      const dominio = erro as ErroDominio;
      expect(dominio.codigo).toBe("transicao_invalida");
      expect(dominio.detalhes.status).toBe(estado);
      expect(dominio.message.length).toBeGreaterThan(0);
    }
  });
});

describe("repositório em memória", () => {
  it("devolve uma cópia, então alterar o objeto lido não apaga o histórico", async () => {
    const repo = new RepositorioMemoria();
    const roteiro = abrir();
    await repo.salvar(roteiro);

    const lido = await repo.buscarPorId(roteiro.id);
    expect(lido).not.toBeNull();
    if (!lido) return;
    const versao = lido.versoes[0];
    if (!versao) return;
    versao.conteudo = "texto adulterado na mão de quem leu";

    const deNovo = await repo.buscarPorId(roteiro.id);
    expect(deNovo?.versoes[0]?.conteudo).toBe("Abertura com o produto na mesa.");
  });
});
