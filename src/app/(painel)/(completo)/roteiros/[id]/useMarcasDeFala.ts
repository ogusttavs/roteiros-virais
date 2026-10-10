"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FalaDoRoteiro, MarcasParaATela } from "@/lib/marcas-de-fala";
import { dadoOuErro } from "@/lib/resultado-acao";
import { textosConexao } from "@/textos/conexao";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { marcarFalaAction } from "./acoes";

type Estado = "ociosa" | "marcando";

type Retorno = {
  /** As marcas que existem agora (as do servidor ou as que acabaram de chegar); nulo enquanto não há. */
  marcas: MarcasParaATela | null;
  estado: Estado;
  /** A frase da última falha de quem pediu as marcas de propósito (a chave); nunca a do pedido em segundo plano. */
  erro: string | null;
  /**
   * Pede as marcas, se ainda não existem e se der para escrever (Reels falado, fora do "ver como"). `emSegundoPlano` não mostra erro nenhum: é o pedido que a tela faz ao abrir, para
   * o modo gravação encontrar as marcas prontas.
   */
  pedir: (opcoes?: { emSegundoPlano?: boolean }) => void;
};

/**
 * O estado das marcas de fala de um roteiro, nas duas telas (E41 parte 2b). Um pedido por vez (um segundo pedido enquanto o primeiro corre não faz nada: o servidor também espera a
 * mesma chamada). `chaveDoTexto` muda quando o texto falado muda (depois de editar): as marcas voltam ao que o servidor mandou, e quem usa o gancho pede de novo.
 */
export function useMarcasDeFala(roteiroId: number, fala: FalaDoRoteiro, chaveDoTexto: string): Retorno {
  const tratarFalha = useTratarFalha();
  const [marcas, setMarcas] = useState<MarcasParaATela | null>(fala.marcas);
  const [estado, setEstado] = useState<Estado>("ociosa");
  const [erro, setErro] = useState<string | null>(null);
  const emVoo = useRef(false);
  /** A geração do texto: um pedido que volta depois de o texto mudar é de um texto que já não existe. */
  const geracao = useRef(0);
  const marcasRef = useRef(marcas);
  marcasRef.current = marcas;

  useEffect(() => {
    geracao.current += 1;
    emVoo.current = false;
    setMarcas(fala.marcas);
    setEstado("ociosa");
    setErro(null);
    // `fala.marcas` é um objeto novo a cada renderização do servidor: o texto (e só ele) decide quando recomeçar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoTexto]);

  const pedir = useCallback(
    (opcoes: { emSegundoPlano?: boolean } = {}) => {
      if (!fala.podeMarcar || fala.somenteLeitura || marcasRef.current || emVoo.current) return;
      emVoo.current = true;
      const desta = geracao.current;
      setEstado("marcando");
      if (!opcoes.emSegundoPlano) setErro(null);
      marcarFalaAction(roteiroId)
        .then(dadoOuErro)
        .then((dado) => {
          if (desta !== geracao.current) return;
          if (dado.marcas) setMarcas(dado.marcas);
          else if (!opcoes.emSegundoPlano && dado.motivo === "editado_no_meio") setErro(textosMarcasDeFala.erros.editadoNoMeio);
        })
        .catch((falha) => {
          if (desta !== geracao.current || opcoes.emSegundoPlano) return;
          setErro(tratarFalha(falha, textosMarcasDeFala.erros.naoDeu, textosConexao.conexaoCaiuNoMeio));
        })
        .finally(() => {
          if (desta !== geracao.current) return;
          emVoo.current = false;
          setEstado("ociosa");
        });
    },
    [fala.podeMarcar, fala.somenteLeitura, roteiroId, tratarFalha],
  );

  return { marcas, estado, erro, pedir };
}
