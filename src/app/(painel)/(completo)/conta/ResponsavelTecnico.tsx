"use client";

import { useState } from "react";

import { MAXIMO_RESPONSAVEL_TECNICO } from "@/carrossel/responsavel-tecnico";
import { textosConta } from "@/textos/conta";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { salvarResponsavelTecnicoAction } from "./responsavel-acoes";
import styles from "./ResponsavelTecnico.module.css";

const t = textosConta.responsavel;

/** O cartão "Responsável técnico" da Conta, só para marca de ramo de saúde: uma linha que sai no último slide do carrossel. No "ver como" fica desligado. */
export function ResponsavelTecnico({ inicial, desligadoVerComo }: { inicial: string; desligadoVerComo?: string }) {
  const [linha, setLinha] = useState(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [estado, setEstado] = useState<"parado" | "salvando" | "salvo">("parado");
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setEstado("salvando");
    setErro(null);
    try {
      const r = await salvarResponsavelTecnicoAction(linha);
      if (!r.ok) {
        setErro(r.erro);
        setEstado("parado");
        return;
      }
      setLinha(r.dado.linha ?? "");
      setGuardado(r.dado.linha ?? "");
      setEstado("salvo");
    } catch {
      setErro(t.erro);
      setEstado("parado");
    }
  }

  return (
    <section className={styles.cartao} aria-labelledby="responsavel-tecnico-titulo">
      <h2 id="responsavel-tecnico-titulo" className={styles.titulo}>
        {t.titulo}
      </h2>
      <Campo
        rotulo={t.rotuloDoCampo}
        value={linha}
        placeholder={t.exemplo}
        maxLength={MAXIMO_RESPONSAVEL_TECNICO}
        contador={`${linha.length}/${MAXIMO_RESPONSAVEL_TECNICO}`}
        ajuda={desligadoVerComo ?? t.ajuda}
        erro={erro ?? undefined}
        disabled={Boolean(desligadoVerComo)}
        onChange={(e) => {
          setLinha(e.target.value);
          setEstado("parado");
        }}
      />
      <Botao
        type="button"
        aria-label={t.nomeDoBotao[estado === "salvando" ? "salvando" : estado === "salvo" ? "salvo" : "salvar"]}
        onClick={() => void salvar()}
        disabled={Boolean(desligadoVerComo) || estado === "salvando" || linha === guardado}
      >
        {estado === "salvando" ? t.salvando : estado === "salvo" ? t.salvo : t.salvar}
      </Botao>
    </section>
  );
}
