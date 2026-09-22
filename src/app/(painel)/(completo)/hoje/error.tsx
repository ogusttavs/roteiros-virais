"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";

import { HojeCabecalho } from "./HojeCabecalho";
import styles from "./HojeTela.module.css";

/**
 * Estado de erro de `/hoje` (design v2, Hoje.Erro). `captureException` aqui
 * (etapa 13, decisão 1) só manda algo quando o Sentry do navegador existir;
 * nesta rodada, sem `Sentry.init` do lado do cliente, é um no-op seguro que
 * já deixa o ponto certo pronto.
 */
export default function ErroHoje({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    captureException(error);
  }, [error]);

  /**
   * Só `reset()` refaz a renderização no cliente: quando a falha veio do servidor (banco lento, tempo
   * esgotado), a tela voltava idêntica, com o mesmo erro e sem sinal nenhum, e parecia travada (V7, item 4
   * do PROXIMO.md). `router.refresh()` pede a página de novo ao servidor, e a transição mantém o botão em
   * andamento até chegar.
   */
  function tentarDeNovo() {
    iniciarTransicao(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className={styles.pagina}>
      <BarraTopo titulo={textosHoje.titulo} />
      <div className={styles.miolo}>
        <HojeCabecalho constancia={{ tipo: "primeiro_dia" }} estado="erro" />
        <div className={styles.estadoCartao}>
          <span className={styles.estadoAviso}>
            <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
            {textosHoje.erroAviso}
          </span>
          <h3>{textosHoje.erroTitulo}</h3>
          <p>{textosHoje.erro}</p>
          <div className={styles.estadoAcoes}>
            <Botao variante="primario" tamanho="lg" carregando={pendente} onClick={tentarDeNovo}>
              {textosHoje.tentarDeNovo}
            </Botao>
          </div>
        </div>
      </div>
    </div>
  );
}
