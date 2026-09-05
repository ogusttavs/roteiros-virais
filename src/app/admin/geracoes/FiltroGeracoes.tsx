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
 * Tarefa e cliente, os dois opcionais (decisao 1 do PROXIMO.md). `aria-label`
 * direto no `<select>`, sem `<label>` envolvendo: achado da etapa 24
 * (`getByLabel` travava num select dentro de `<label>`; `aria-label` evita o
 * problema na raiz, sem precisar escopar a um dialog que esta tela nao tem.
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
