"use client";

import { createContext, useCallback, useContext } from "react";

import { ehFalhaDeRede } from "@/lib/offline";
import { textosConexao } from "@/textos/conexao";

/**
 * O estado de rede do painel (V7, itens 4 e 8 do PROXIMO.md). O provedor de
 * verdade e `Conexao` (`(painel)/_casca/Conexao.tsx`); fora dele (admin, telas
 * publicas, testes de componente) o valor padrao diz "com rede" e as funcoes
 * nao fazem nada, entao `Botao precisaDeRede` funciona em qualquer lugar.
 */
export type ConexaoValor = {
  /** Sem rede agora: `navigator.onLine` falso ou o ultimo pedido ao servidor caiu por rede. */
  semConexao: boolean;
  /** Uma acao que chamou o servidor caiu por rede: a faixa aparece ate a rede voltar. */
  avisarFalhaDeRede: () => void;
  /** Uma chamada ao servidor deu certo: a rede esta de volta. */
  avisarRedeOk: () => void;
};

export const ID_FAIXA_SEM_CONEXAO = "faixa-sem-conexao";

export const ConexaoContext = createContext<ConexaoValor>({
  semConexao: false,
  avisarFalhaDeRede: () => undefined,
  avisarRedeOk: () => undefined,
});

export function useConexao(): ConexaoValor {
  return useContext(ConexaoContext);
}

/**
 * O que todo `catch` de uma acao que chama o servidor faz (V7, item 4 do
 * PROXIMO.md): devolve a frase para mostrar e, quando a falha foi de rede,
 * acende a faixa "Sem conexao" (ate a rede voltar).
 *
 *     } catch (erro) {
 *       setErro(tratarFalha(erro, textosX.erro));
 *     }
 *
 * `padrao` e a frase de sempre (falha do servidor); `aoCair` troca a frase de
 * rede nas acoes que criam algo (`textosConexao.conexaoCaiuNoMeio`).
 */
export function useTratarFalha(): (erro: unknown, padrao: string, aoCair?: string) => string {
  const { avisarFalhaDeRede } = useConexao();
  return useCallback(
    (erro: unknown, padrao: string, aoCair: string = textosConexao.falhaDeRede) => {
      if (!ehFalhaDeRede(erro)) return padrao;
      avisarFalhaDeRede();
      return aoCair;
    },
    [avisarFalhaDeRede],
  );
}
