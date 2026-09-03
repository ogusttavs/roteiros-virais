"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { SaidaAvaliarTema } from "@/ia/prompts/avaliarTema";
import { textosTemaLivre } from "@/textos/tema-livre";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { Nota } from "@/ui/componentes/Nota";
import { faixaDeNota } from "@/ui/componentes/notaFaixa";
import { Pilares } from "@/ui/componentes/PilarLinha";
import { Progresso } from "@/ui/componentes/Progresso";

import { avaliarTemaAction } from "./acoes";
import styles from "./TemaLivreTela.module.css";

type Props = { notaMinima: number };

const ORDEM_PILARES: { chave: keyof SaidaAvaliarTema["pilares"]; indice: number }[] = [
  { chave: "viralizar", indice: 0 },
  { chave: "gerarCliente", indice: 1 },
  { chave: "encaixe", indice: 2 },
  { chave: "novidade", indice: 3 },
  { chave: "facilidade", indice: 4 },
];

/** `/hoje/tema-livre` (etapa 10, brief-frontend.md 6.4). */
export function TemaLivreTela({ notaMinima }: Props) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [campoVazio, setCampoVazio] = useState(false);
  const [resultado, setResultado] = useState<SaidaAvaliarTema | null>(null);
  const [erro, setErro] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();

  function avaliar(textoParaAvaliar: string) {
    const limpo = textoParaAvaliar.trim();
    if (!limpo) {
      setCampoVazio(true);
      return;
    }
    setCampoVazio(false);
    setErro(false);
    iniciarTransicao(async () => {
      try {
        const dados = await avaliarTemaAction(limpo);
        setTexto(limpo);
        setResultado(dados);
      } catch {
        setErro(true);
      }
    });
  }

  if (pendente) {
    return (
      <div className={styles.pagina}>
        <Progresso mensagem={textosTemaLivre.esperando} />
      </div>
    );
  }

  if (resultado) {
    const semEvidencia = resultado.evidencias.length === 0;
    const aprovado = resultado.nota >= notaMinima;

    return (
      <div className={styles.pagina}>
        <Nota valor={resultado.nota} legenda={faixaDeNota(resultado.nota)} tamanho="destaque" />
        {semEvidencia ? <p className={styles.semEvidencia}>{textosTemaLivre.semEvidencia}</p> : null}

        <Pilares
          pilares={ORDEM_PILARES.map(({ chave, indice }) => ({
            nome: textosTemaLivre.pilares[indice],
            valor: resultado.pilares[chave].nota,
            porque: resultado.pilares[chave].justificativa,
          }))}
        />

        {aprovado ? (
          <BarraAcao primaria={{ rotulo: textosTemaLivre.escrever, onClick: () => router.push("/hoje/objetivo") }} />
        ) : resultado.anguloSugerido ? (
          <div className={styles.cartaoAngulo}>
            <h2 className={styles.anguloTitulo}>{textosTemaLivre.anguloTitulo}</h2>
            <p className={styles.anguloTexto}>{resultado.anguloSugerido}</p>
            <BarraAcao
              primaria={{ rotulo: textosTemaLivre.usarAngulo, onClick: () => avaliar(resultado.anguloSugerido!) }}
              secundaria={{
                rotulo: textosTemaLivre.seguirMeu,
                onClick: () => router.push("/hoje/objetivo"),
              }}
            />
          </div>
        ) : (
          <BarraAcao secundaria={{ rotulo: textosTemaLivre.seguirMeu, onClick: () => router.push("/hoje/objetivo") }} />
        )}

        <button type="button" className={styles.avaliarOutro} onClick={() => setResultado(null)}>
          {textosTemaLivre.avaliarOutro}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{textosTemaLivre.titulo}</h1>
      <AreaTexto
        rotulo={textosTemaLivre.titulo}
        rotuloOculto
        placeholder={textosTemaLivre.placeholder}
        ajuda={textosTemaLivre.ajuda}
        erro={campoVazio ? textosTemaLivre.campoVazio : erro ? textosTemaLivre.erro : undefined}
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        linhasMin={4}
      />
      <BarraAcao primaria={{ rotulo: textosTemaLivre.avaliar, onClick: () => avaliar(texto) }} />
    </div>
  );
}
