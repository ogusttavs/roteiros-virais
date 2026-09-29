"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { textosAdmin } from "@/textos/admin";

import styles from "./page.module.css";

const t = textosAdmin.viagem;

type Props = { marcas: { id: number; nome: string }[] };

/** O filtro de marca (o de período é chip, na própria página, mesmo padrão de `/admin/geracoes`). */
export function FiltroViagem({ marcas }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function atualizar(valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor) params.set("marcaId", valor);
    else params.delete("marcaId");
    router.push(`/admin/viagem?${params.toString()}`);
  }

  return (
    <label className={styles.filtroCampo}>
      {t.filtroMarcaRotulo}
      <select aria-label={t.filtroMarcaRotulo} value={searchParams.get("marcaId") ?? ""} onChange={(evento) => atualizar(evento.target.value)}>
        <option value="">{t.filtroMarcaTodas}</option>
        {marcas.map((marca) => (
          <option key={marca.id} value={marca.id}>
            {marca.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
