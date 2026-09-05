"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { textosAdmin } from "@/textos/admin";

import styles from "./page.module.css";

const t = textosAdmin.geracoes;

type Props = {
  tarefas: string[];
  clientes: { id: number; nome: string }[];
};

/**
 * Tarefa e cliente, os dois opcionais (decisao 1 do PROXIMO.md).
 * `aria-label` direto no `<select>` mesmo com o `<label>` visivel
 * envolvendo: achado rodando de verdade nesta propria tela (nao so no
 * `<dialog>` do ModalConvidarCliente, etapa 24) e confirmado ao contrario
 * tambem, tirando o aria-label de proposito para testar: sem ele,
 * `getByLabel` do Playwright nao encontra o `<select>` (timeout, sem erro
 * de ambiguidade), com ele encontra. `<label>` sozinho ao redor de um
 * `<select>` nao e o bastante; `tests/e2e/geracoes.spec.ts` prova os dois
 * lados.
 */
export function FiltroGeracoes({ tarefas, clientes }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function atualizar(chave: string, valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor) params.set(chave, valor);
    else params.delete(chave);
    router.push(`/admin/geracoes?${params.toString()}`);
  }

  return (
    <div className={styles.linhaFiltros}>
      <label className={styles.filtroCampo}>
        {t.filtroTarefaRotulo}
        <select
          aria-label={t.filtroTarefaRotulo}
          value={searchParams.get("tarefa") ?? ""}
          onChange={(evento) => atualizar("tarefa", evento.target.value)}
        >
          <option value="">{t.filtroTarefaTodas}</option>
          {tarefas.map((tarefa) => (
            <option key={tarefa} value={tarefa}>
              {tarefa}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.filtroCampo}>
        {t.filtroClienteRotulo}
        <select
          aria-label={t.filtroClienteRotulo}
          value={searchParams.get("clienteId") ?? ""}
          onChange={(evento) => atualizar("clienteId", evento.target.value)}
        >
          <option value="">{t.filtroClienteTodos}</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nome}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
