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
  /** As marcas que existem agora para o texto de agora (as do servidor ou as que acabaram de chegar); nulo enquanto não há. */
  marcas: MarcasParaATela | null;
  estado: Estado;
  /** A frase da última falha de quem pediu as marcas de propósito (a chave); nunca a de um pedido que ninguém estava esperando. */
  erro: string | null;
  /**
   * Pede as marcas, se ainda não existem e se der para escrever (Reels falado, fora do "ver como"). `emSegundoPlano` não mostra erro nenhum: é o pedido que a tela faz ao abrir, para
   * o modo gravação encontrar as marcas prontas. Se a pessoa liga a chave com esse pedido ainda correndo, ela passa a esperá-lo: a espera e o erro dele são dela.
   */
  pedir: (opcoes?: { emSegundoPlano?: boolean }) => void;
};

/**
 * O estado das marcas de fala de um roteiro, nas duas telas (E41 parte 2b). Um pedido por vez. `chaveDoTexto` muda quando o texto falado muda (depois de editar): as marcas que
 * valem são sempre as do texto de agora (derivadas na renderização, nunca um quadro com as marcas do texto antigo), e quem usa o gancho pede de novo.
 */
export function useMarcasDeFala(roteiroId: number, fala: FalaDoRoteiro, chaveDoTexto: string): Retorno {
  const tratarFalha = useTratarFalha();
  /** O que chegou por um pedido, com a chave do texto de que saiu: só vale enquanto o texto de agora for esse. */
  const [recebidas, setRecebidas] = useState<{ chave: string; marcas: MarcasParaATela } | null>(null);
  const [estado, setEstado] = useState<Estado>("ociosa");
  const [erro, setErro] = useState<string | null>(null);
  const marcas = recebidas && recebidas.chave === chaveDoTexto ? recebidas.marcas : fala.marcas;

  const emVoo = useRef(false);
  /** Quem espera o pedido em voo: falso enquanto só a tela o fez em segundo plano; vira verdadeiro quando a pessoa liga a chave. */
  const alguemEspera = useRef(false);
  /** A geração do texto: um pedido que volta depois de o texto mudar é de um texto que já não existe. */
  const geracao = useRef(0);
  const marcasRef = useRef(marcas);
  marcasRef.current = marcas;

  useEffect(() => {
    geracao.current += 1;
    emVoo.current = false;
    alguemEspera.current = false;
    setEstado("ociosa");
    setErro(null);
  }, [chaveDoTexto]);

  const pedir = useCallback(
    (opcoes: { emSegundoPlano?: boolean } = {}) => {
      if (!fala.podeMarcar || fala.somenteLeitura || marcasRef.current) return;
      if (emVoo.current) {
        // A pessoa ligou a chave com o pedido de segundo plano ainda correndo: a espera e o erro dele passam a ser dela.
        if (!opcoes.emSegundoPlano) {
          alguemEspera.current = true;
          setErro(null);
        }
        return;
      }
      emVoo.current = true;
      alguemEspera.current = !opcoes.emSegundoPlano;
      const desta = geracao.current;
      const chave = chaveDoTexto;
      setEstado("marcando");
      if (!opcoes.emSegundoPlano) setErro(null);
      marcarFalaAction(roteiroId)
        .then(dadoOuErro)
        .then((dado) => {
          if (desta !== geracao.current) return;
          if (dado.marcas) setRecebidas({ chave, marcas: dado.marcas });
          else if (alguemEspera.current && dado.motivo === "editado_no_meio") setErro(textosMarcasDeFala.erros.editadoNoMeio);
        })
        .catch((falha) => {
          if (desta !== geracao.current || !alguemEspera.current) return;
          setErro(tratarFalha(falha, textosMarcasDeFala.erros.naoDeu, textosConexao.conexaoCaiuNoMeio));
        })
        .finally(() => {
          if (desta !== geracao.current) return;
          emVoo.current = false;
          alguemEspera.current = false;
          setEstado("ociosa");
        });
    },
    [chaveDoTexto, fala.podeMarcar, fala.somenteLeitura, roteiroId, tratarFalha],
  );

  return { marcas, estado, erro, pedir };
}
