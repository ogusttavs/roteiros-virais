"use client";

import { useState } from "react";

import { useTecladoAberto } from "@/app/(painel)/_casca/useTeclado";
import { textosConta } from "@/textos/conta";
import { Folha } from "@/ui/componentes/Folha";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./InformacoesDoAparelho.module.css";
import { jaEstaInstalado } from "./InstalarNoCelular";

type Props = {
  /** `config.gitSha`, lido no servidor (`page.tsx`): o build do Next não expõe env var nenhuma ao navegador sem o prefixo `NEXT_PUBLIC_`, e esta não precisa de mais nenhuma. */
  versaoPainel: string;
};

function numeroPx(valor: number): string {
  return `${Math.round(valor)}px`;
}

/** As quatro áreas seguras, escritas em `base.css` como variáveis CSS (`--area-topo` e as três novas desta rodada), lidas de volta por `getComputedStyle`. */
function areaSegura(nomeVariavel: string): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nomeVariavel).trim();
  return valor || "0px";
}

/**
 * H3, item 4: só leitura, monta os dados na hora que abre (um retrato do
 * instante, não uma tela viva). Sem dado de cliente, sem chamada ao
 * servidor: só o que o próprio navegador já sabe.
 */
function montarDiagnostico(versaoPainel: string, tecladoAberto: boolean) {
  const vv = window.visualViewport;
  const t = textosConta.diagnostico;
  return [
    { rotulo: t.larguraJanela, valor: numeroPx(window.innerWidth) },
    { rotulo: t.alturaJanela, valor: numeroPx(window.innerHeight) },
    { rotulo: t.alturaVisivel, valor: vv ? numeroPx(vv.height) : t.naoDisponivel },
    { rotulo: t.escala, valor: vv ? vv.scale.toFixed(2) : t.naoDisponivel },
    { rotulo: t.areaSeguraTopo, valor: areaSegura("--area-topo") },
    { rotulo: t.areaSeguraBaixo, valor: areaSegura("--area-baixo") },
    { rotulo: t.areaSeguraEsquerda, valor: areaSegura("--area-esquerda") },
    { rotulo: t.areaSeguraDireita, valor: areaSegura("--area-direita") },
    { rotulo: t.modoAplicativo, valor: jaEstaInstalado() ? t.sim : t.nao },
    { rotulo: t.tecladoAberto, valor: tecladoAberto ? t.sim : t.nao },
    { rotulo: t.versaoPainel, valor: versaoPainel || t.versaoDesconhecida },
    { rotulo: t.navegador, valor: navigator.userAgent },
  ];
}

export function InformacoesDoAparelho({ versaoPainel }: Props) {
  const [aberta, setAberta] = useState(false);
  const { fechar } = useFolhaNoHistorico(aberta, () => setAberta(false));
  const tecladoAberto = useTecladoAberto();
  const [copiado, setCopiado] = useState(false);

  const t = textosConta.diagnostico;
  // Só recalcula quando a folha abre: é um retrato do instante, não uma tela viva (comentário de `montarDiagnostico`).
  const linhas = aberta ? montarDiagnostico(versaoPainel, tecladoAberto) : [];

  async function copiar() {
    const texto = linhas.map((linha) => `${linha.rotulo}: ${linha.valor}`).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de clipboard, ou aparelho sem suporte: a folha continua com o texto na tela, para copiar à mão.
    }
  }

  return (
    <>
      <button type="button" className={styles.linha} onClick={() => setAberta(true)}>
        {t.linha}
      </button>

      {aberta ? (
        <Folha
          titulo={t.tituloFolha}
          aberto={aberta}
          aoFechar={fechar}
          rodape={
            <button type="button" className={styles.botaoCopiar} onClick={copiar}>
              {copiado ? t.copiado : t.copiar}
            </button>
          }
        >
          <p className={styles.explica}>{t.explica}</p>
          <dl className={styles.lista}>
            {linhas.map((linha) => (
              <div key={linha.rotulo} className={styles.linhaDado}>
                <dt>{linha.rotulo}</dt>
                <dd>{linha.valor}</dd>
              </div>
            ))}
          </dl>
        </Folha>
      ) : null}
    </>
  );
}
