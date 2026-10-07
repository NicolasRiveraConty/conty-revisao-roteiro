/**
 * Revisão de roteiro, antes do vídeo.
 *
 * O estado do roteiro diz quem age agora. O estado da versão diz o que
 * aconteceu com aquele texto. Versão enviada não é reescrita: correção é
 * outra versão, e a anterior fica no histórico com o pedido da marca.
 *
 *   (novo) --criador envia v1--> aguardando_marca
 *   aguardando_marca --pedir alteração--> aguardando_criador
 *   aguardando_marca --aprovar--> aprovado
 *   aguardando_criador --enviar versão--> aguardando_marca
 *
 * Aprovado é terminal. A tabela TRANSICOES é a única lista de movimentos
 * válidos; o restante do módulo só aplica o efeito de cada um.
 */

export type StatusRoteiro = "aguardando_marca" | "aguardando_criador" | "aprovado";

export type StatusVersao = "em_analise" | "alteracao_pedida" | "aprovada";

export type Acao = "pedir_alteracao" | "aprovar" | "enviar_versao";

export type Ator = "marca" | "criador";

export type PedidoAlteracao = {
  motivo: string;
  prazo: string;
  solicitadoEm: string;
};

export type Versao = {
  id: string;
  numero: number;
  conteudo: string;
  status: StatusVersao;
  criadaEm: string;
  pedidoAlteracao?: PedidoAlteracao;
  aprovadaEm?: string;
};

export type Roteiro = {
  id: string;
  campanhaId: string;
  status: StatusRoteiro;
  criadoEm: string;
  atualizadoEm: string;
  versoes: Versao[];
};

export type OpcaoAcao = {
  acao: Acao;
  metodo: "POST";
  caminho: string;
  corpo?: readonly string[];
};

export type ProximaAcao = {
  ator: Ator | null;
  descricao: string;
  opcoes: OpcaoAcao[];
};

export type RoteiroVisao = Roteiro & {
  versaoAtual: Versao;
  proximaAcao: ProximaAcao;
};

export type DependenciasDominio = {
  agora: () => Date;
  novoId: () => string;
};

export type CodigoErro = "validacao" | "transicao_invalida" | "nao_encontrado";

export class ErroDominio extends Error {
  readonly codigo: CodigoErro;
  readonly detalhes: Record<string, unknown>;

  constructor(codigo: CodigoErro, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "ErroDominio";
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const TRANSICOES: Record<StatusRoteiro, Partial<Record<Acao, StatusRoteiro>>> = {
  aguardando_marca: {
    pedir_alteracao: "aguardando_criador",
    aprovar: "aprovado",
  },
  aguardando_criador: {
    enviar_versao: "aguardando_marca",
  },
  aprovado: {},
};

const ORDEM_ACOES: readonly Acao[] = ["pedir_alteracao", "aprovar", "enviar_versao"];

const ATOR_DA_ACAO: Record<Acao, Ator> = {
  pedir_alteracao: "marca",
  aprovar: "marca",
  enviar_versao: "criador",
};

const DETALHE_ACAO: Record<Acao, { sufixo: string; corpo?: readonly string[] }> = {
  pedir_alteracao: { sufixo: "pedidos-alteracao", corpo: ["motivo", "prazo"] },
  aprovar: { sufixo: "aprovacao" },
  enviar_versao: { sufixo: "versoes", corpo: ["conteudo"] },
};

const DESCRICAO: Record<StatusRoteiro, string> = {
  aguardando_marca:
    "A marca analisa a versão atual. Pode pedir alteração, com motivo e prazo, ou aprovar e encerrar a revisão.",
  aguardando_criador:
    "O criador lê o pedido gravado na versão atual e envia outra versão. A versão anterior permanece no histórico.",
  aprovado:
    "A revisão está encerrada. A versão aprovada e as anteriores continuam disponíveis para consulta.",
};

const NOME_ACAO: Record<Acao, string> = {
  pedir_alteracao: "pedir alteração",
  aprovar: "aprovar o roteiro",
  enviar_versao: "enviar uma nova versão",
};

const PORQUE_NAO: Record<StatusRoteiro, string> = {
  aguardando_marca:
    "A versão atual está em análise pela marca, que pode pedir alteração (motivo e prazo) ou aprovar.",
  aguardando_criador:
    "O roteiro está aguardando o criador enviar outra versão. A marca decide de novo quando essa versão chegar.",
  aprovado: "A aprovação encerrou a revisão.",
};

const EXEMPLO_PRAZO = "2026-10-10T18:00:00.000Z";
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_DATA_HORA =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function descreverProximaAcao(roteiro: Pick<Roteiro, "id" | "status">): ProximaAcao {
  const acoes = ORDEM_ACOES.filter((acao) => TRANSICOES[roteiro.status][acao] !== undefined);
  const atores = new Set(acoes.map((acao) => ATOR_DA_ACAO[acao]));
  const [ator] = atores;

  return {
    ator: atores.size === 1 ? (ator ?? null) : null,
    descricao: DESCRICAO[roteiro.status],
    opcoes: acoes.map((acao) => {
      const detalhe = DETALHE_ACAO[acao];
      return {
        acao,
        metodo: "POST" as const,
        caminho: `/roteiros/${roteiro.id}/${detalhe.sufixo}`,
        ...(detalhe.corpo ? { corpo: detalhe.corpo } : {}),
      };
    }),
  };
}

export function apresentar(roteiro: Roteiro): RoteiroVisao {
  const copia = structuredClone(roteiro);
  const versaoAtual = copia.versoes.at(-1);
  if (!versaoAtual) {
    throw new Error("Roteiro sem versão.");
  }
  return {
    ...copia,
    versaoAtual,
    proximaAcao: descreverProximaAcao(copia),
  };
}

export function criarRoteiro(
  entrada: { campanhaId: unknown; conteudo: unknown },
  deps: DependenciasDominio,
): Roteiro {
  const campos: Record<string, string> = {};
  const campanhaId = lerTexto(entrada.campanhaId);
  const conteudo = lerTexto(entrada.conteudo);
  if (!campanhaId) campos.campanhaId = "Informe a campanha.";
  if (!conteudo) campos.conteudo = "Informe o texto do roteiro.";
  if (!campanhaId || !conteudo) {
    throw new ErroDominio(
      "validacao",
      "Para abrir a revisão, informe a campanha e o conteúdo da primeira versão.",
      { campos },
    );
  }

  const agora = deps.agora().toISOString();
  return {
    id: `rot_${deps.novoId()}`,
    campanhaId,
    status: "aguardando_marca",
    criadoEm: agora,
    atualizadoEm: agora,
    versoes: [
      {
        id: `ver_${deps.novoId()}`,
        numero: 1,
        conteudo,
        status: "em_analise",
        criadaEm: agora,
      },
    ],
  };
}

export function pedirAlteracao(
  roteiro: Roteiro,
  entrada: { motivo: unknown; prazo: unknown },
  deps: DependenciasDominio,
): Roteiro {
  const campos: Record<string, string> = {};
  const motivo = lerTexto(entrada.motivo);
  const prazo = interpretarPrazo(entrada.prazo, deps.agora());
  if (!motivo) campos.motivo = "Informe o que precisa mudar.";
  if (!prazo.ok) campos.prazo = prazo.mensagem;
  if (!motivo || !prazo.ok) {
    throw new ErroDominio("validacao", "Pedido de alteração exige motivo e um prazo futuro.", {
      campos,
    });
  }

  const status = exigirTransicao(roteiro, "pedir_alteracao");
  const agora = deps.agora().toISOString();
  const ultimo = roteiro.versoes.length - 1;

  return {
    ...roteiro,
    status,
    atualizadoEm: agora,
    versoes: roteiro.versoes.map((versao, indice) =>
      indice === ultimo
        ? {
            ...versao,
            status: "alteracao_pedida" as const,
            pedidoAlteracao: { motivo, prazo: prazo.iso, solicitadoEm: agora },
          }
        : versao,
    ),
  };
}

export function aprovar(roteiro: Roteiro, deps: DependenciasDominio): Roteiro {
  const status = exigirTransicao(roteiro, "aprovar");
  const agora = deps.agora().toISOString();
  const ultimo = roteiro.versoes.length - 1;

  return {
    ...roteiro,
    status,
    atualizadoEm: agora,
    versoes: roteiro.versoes.map((versao, indice) =>
      indice === ultimo ? { ...versao, status: "aprovada" as const, aprovadaEm: agora } : versao,
    ),
  };
}

export function enviarVersao(
  roteiro: Roteiro,
  entrada: { conteudo: unknown },
  deps: DependenciasDominio,
): Roteiro {
  const conteudo = lerTexto(entrada.conteudo);
  if (!conteudo) {
    throw new ErroDominio("validacao", "A nova versão precisa de conteúdo.", {
      campos: { conteudo: "Informe o texto do roteiro." },
    });
  }

  const status = exigirTransicao(roteiro, "enviar_versao");
  const agora = deps.agora().toISOString();
  const anterior = roteiro.versoes.at(-1);
  if (!anterior) {
    throw new Error("Roteiro sem versão.");
  }

  const nova: Versao = {
    id: `ver_${deps.novoId()}`,
    numero: anterior.numero + 1,
    conteudo,
    status: "em_analise",
    criadaEm: agora,
  };

  return {
    ...roteiro,
    status,
    atualizadoEm: agora,
    versoes: [...roteiro.versoes, nova],
  };
}

function exigirTransicao(roteiro: Roteiro, acao: Acao): StatusRoteiro {
  const destino = TRANSICOES[roteiro.status][acao];
  if (!destino) {
    throw new ErroDominio("transicao_invalida", mensagemTransicao(roteiro.status, acao), {
      status: roteiro.status,
      proximaAcao: descreverProximaAcao(roteiro),
    });
  }
  return destino;
}

function mensagemTransicao(status: StatusRoteiro, acao: Acao): string {
  return `Não é possível ${NOME_ACAO[acao]}. ${PORQUE_NAO[status]}`;
}

function lerTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto.length > 0 ? texto : null;
}

type PrazoOk = { ok: true; iso: string };
type PrazoErro = { ok: false; mensagem: string };

function interpretarPrazo(valor: unknown, agora: Date): PrazoOk | PrazoErro {
  const formato = `Informe até quando, no formato ISO-8601 (ex.: ${EXEMPLO_PRAZO}).`;
  if (typeof valor !== "string" || valor.trim() === "") {
    return { ok: false, mensagem: formato };
  }

  const texto = valor.trim();
  const soData = RE_DATA.exec(texto);
  const dataHora = RE_DATA_HORA.exec(texto);
  const partes = soData ?? dataHora;
  if (!partes) return { ok: false, mensagem: formato };

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  if (!calendarioValido(ano, mes, dia)) {
    return { ok: false, mensagem: "A data do prazo não existe no calendário." };
  }

  if (dataHora) {
    const hora = Number(dataHora[4]);
    const minuto = Number(dataHora[5]);
    const segundo = Number(dataHora[6]);
    if (hora > 23 || minuto > 59 || segundo > 59) {
      return { ok: false, mensagem: formato };
    }
  }

  const instante = new Date(soData ? `${texto}T23:59:59.999Z` : texto);
  if (Number.isNaN(instante.getTime())) return { ok: false, mensagem: formato };
  if (instante.getTime() <= agora.getTime()) {
    return { ok: false, mensagem: "O prazo precisa ser posterior ao momento do pedido." };
  }
  return { ok: true, iso: instante.toISOString() };
}

function calendarioValido(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}
