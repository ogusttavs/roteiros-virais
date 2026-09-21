"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { avisarRedeVoltou } from "@/lib/estado-de-rede";
import { caminhosEstaticosCarregados, chaveDoEscopo, ehPaginaGuardavel, registrarEscopo } from "@/lib/offline";
import { textosConexao } from "@/textos/conexao";
import { ConexaoContext, ID_FAIXA_SEM_CONEXAO } from "@/ui/ConexaoContext";
import { useSemRede } from "@/ui/useSemRede";

import styles from "./Conexao.module.css";

/** De quanto em quanto tempo a faixa confere se a rede voltou, quando ela acendeu por um pedido que caiu. */
const INTERVALO_SONDA_MS = 5000;

/**
 * O painel sem rede (V7, itens 5 a 10 do PROXIMO.md), do lado da pagina:
 * registra o service worker (`public/sw.js`), grava o escopo (usuario mais
 * marca) que ele usa para guardar, pede para guardar a pagina aberta e os
 * arquivos que ela carregou, e mostra a faixa "Sem conexao" enquanto o
 * aparelho estiver sem rede ou o ultimo pedido ao servidor tiver caido.
 *
 * O escopo e gravado ANTES do registro do worker (e apaga na hora o que
 * pertence a outro usuario ou a outra marca): e isso que faz o roteiro da
 * Marca Um sumir do aparelho quando o cliente abre a Marca Dois.
 *
 * So em producao registra o worker: em `next dev` ele guardaria pagina velha
 * por cima de cada recompilacao. Sem suporte do navegador (ou se o registro
 * falhar), o painel funciona igual, so nao abre sem rede.
 */
export function Conexao({ usuarioId, marcaId, children }: { usuarioId: string; marcaId: number; children: ReactNode }) {
  const pathname = usePathname();
  // Aparelho sem rede, ou a pagina na tela foi servida do guardado (estado-de-rede.ts).
  const semRede = useSemRede();
  const [ultimoPedidoCaiu, setUltimoPedidoCaiu] = useState(false);
  const semConexao = semRede || ultimoPedidoCaiu;

  useEffect(() => {
    // A rede voltou (o navegador avisou): a faixa some. `estado-de-rede.ts` cuida da marca do guardado.
    function aoVoltar() {
      setUltimoPedidoCaiu(false);
    }
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, []);

  // A faixa esta acesa mas o navegador diz que tem rede (sinal fraco, portal de wifi, pagina servida do
  // guardado, um pedido que caiu): sem esta conferencia ela so sumiria quando uma acao desse certo, e as
  // acoes que precisam de rede estariam desabilitadas. Com `navigator.onLine` falso nao confere: o
  // navegador avisa sozinho quando a rede volta (evento `online`, acima).
  useEffect(() => {
    if (!semConexao || !navigator.onLine) return;
    let cancelado = false;
    const id = setInterval(async () => {
      try {
        const resposta = await fetch("/api/saude", { cache: "no-store" });
        if (cancelado || !resposta.ok) return;
        avisarRedeVoltou();
        setUltimoPedidoCaiu(false);
      } catch {
        // Continua sem rede; confere de novo no proximo intervalo.
      }
    }, INTERVALO_SONDA_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [semConexao]);

  useEffect(() => {
    document.documentElement.dataset.semConexao = semConexao ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.semConexao;
    };
  }, [semConexao]);

  const escopo = chaveDoEscopo(usuarioId, marcaId);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    let cancelado = false;
    (async () => {
      try {
        // Primeiro o escopo (so precisa do Cache Storage): o que e de outro usuario ou de outra marca sai daqui.
        await registrarEscopo(escopo);
        if (cancelado || !("serviceWorker" in navigator)) return;
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const registro = await navigator.serviceWorker.ready;
        if (cancelado || !registro.active) return;
        registro.active.postMessage({
          tipo: "guardar-estaticos",
          caminhos: caminhosEstaticosCarregados(),
        });
        if (ehPaginaGuardavel(pathname)) registro.active.postMessage({ tipo: "guardar-pagina", caminho: pathname });
      } catch {
        // Sem service worker o painel continua igual, so nao abre sem rede.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [escopo, pathname]);

  const avisarFalhaDeRede = useCallback(() => setUltimoPedidoCaiu(true), []);
  const avisarRedeOk = useCallback(() => setUltimoPedidoCaiu(false), []);
  const valor = useMemo(
    () => ({ semConexao, avisarFalhaDeRede, avisarRedeOk }),
    [semConexao, avisarFalhaDeRede, avisarRedeOk],
  );

  return (
    <ConexaoContext.Provider value={valor}>
      {semConexao ? (
        <div id={ID_FAIXA_SEM_CONEXAO} role="status" className={styles.faixa}>
          {textosConexao.faixa}
        </div>
      ) : null}
      {children}
    </ConexaoContext.Provider>
  );
}
