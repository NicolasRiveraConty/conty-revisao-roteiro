import type { Roteiro } from "../dominio/roteiro.js";

export interface RepositorioRoteiro {
  salvar(roteiro: Roteiro): Promise<void>;
  buscarPorId(id: string): Promise<Roteiro | null>;
}

export class RepositorioMemoria implements RepositorioRoteiro {
  private readonly itens = new Map<string, Roteiro>();

  async salvar(roteiro: Roteiro): Promise<void> {
    this.itens.set(roteiro.id, structuredClone(roteiro));
  }

  async buscarPorId(id: string): Promise<Roteiro | null> {
    const item = this.itens.get(id);
    return item ? structuredClone(item) : null;
  }
}
