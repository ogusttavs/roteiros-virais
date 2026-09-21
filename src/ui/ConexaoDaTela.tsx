"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ConexaoContext } from "./ConexaoContext";
import { useSemRede } from "./useSemRede";
import { useSondaDeRede } from "./useSondaDeRede";

/**
 * A versao leve do provedor de conexao para as telas FORA do painel
 * (`/comecar`, a tela em que todo cliente novo escreve o briefing primeiro): so o estado,
 * sem a faixa do topo nem o service worker (`Conexao.tsx`, do layout do
 * painel, faz tudo isso). Com ele, `Botao precisaDeRede` e `tratarFalha`
 * funcionam la do mesmo jeito que no painel: a acao que precisa do servidor
 * fica desabilitada sem rede, com o motivo escrito (V7, itens 4 e 8).
 */
export function ConexaoDaTela({ children }: { children: ReactNode }) {
  const semRede = useSemRede();
  const [ultimoPedidoCaiu, setUltimoPedidoCaiu] = useState(false);

  useEffect(() => {
    function aoVoltar() {
      setUltimoPedidoCaiu(false);
    }
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, []);

  const semConexao = semRede || ultimoPedidoCaiu;
  const avisarFalhaDeRede = useCallback(() => setUltimoPedidoCaiu(true), []);
  const avisarRedeOk = useCallback(() => setUltimoPedidoCaiu(false), []);
  useSondaDeRede(semConexao, avisarRedeOk);

  const valor = useMemo(
    () => ({ semConexao, avisarFalhaDeRede, avisarRedeOk }),
    [semConexao, avisarFalhaDeRede, avisarRedeOk],
  );
  return <ConexaoContext.Provider value={valor}>{children}</ConexaoContext.Provider>;
}
