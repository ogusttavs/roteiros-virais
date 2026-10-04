"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { textosHoje } from "@/textos/hoje";
import { textosPlanejamento } from "@/textos/planejamento";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";

import hojeStyles from "../hoje/HojeTela.module.css";

import { CabecaPlanoEstatica } from "./CabecaPlanoEstatica";

/** Igual a `loading.tsx` (cada boundary é seu próprio módulo, não dá para importar de um cliente
 * para o outro sem os dois virarem o mesmo arquivo). */
const FORMATAR_DIA_MES_COM_MES = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
function tituloSemana(segunda: string, domingo: string): string {
  const [, mesSegunda] = segunda.split("-");
  const [, mesDomingo] = domingo.split("-");
  const [anoS, mesS, diaS] = segunda.split("-").map(Number);
  const [anoD, mesD, diaD] = domingo.split("-").map(Number);
  if (mesSegunda === mesDomingo) {
    const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
    return `${diaS} a ${diaFim}`;
  }
  const diaInicio = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoS, mesS - 1, diaS, 12)));
  const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
  return `${diaInicio} a ${diaFim}`;
}

const FORMATAR_DIA_MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" });
/** Igual a `page.tsx`: a forma curta do período, abaixo de 768px (acabamento da E39c, parte 2a). */
function tituloSemanaCurto(segunda: string, domingo: string): string {
  const [, mesSegunda] = segunda.split("-");
  const [, mesDomingo] = domingo.split("-");
  const [anoS, mesS, diaS] = segunda.split("-").map(Number);
  const [anoD, mesD, diaD] = domingo.split("-").map(Number);
  const mesCurto = (data: Date) => FORMATAR_DIA_MES_CURTO.format(data).replace(/\.$/, "");
  if (mesSegunda === mesDomingo) {
    return `${diaS} a ${diaD} ${mesCurto(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)))}`;
  }
  const inicio = `${diaS} ${mesCurto(new Date(Date.UTC(anoS, mesS - 1, diaS, 12)))}`;
  const fim = `${diaD} ${mesCurto(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)))}`;
  return `${inicio} a ${fim}`;
}

function hojeNoClienteISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Igual a `@/servicos/roteiro`, que não dá para importar aqui: `error.tsx` é Client Component
 * ("use client" obrigatório no Next), e `roteiro.ts` puxa `next/headers` por outro serviço. */
function somarDiasISO(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias, 12)).toISOString().slice(0, 10);
}

/**
 * Estado de erro de `/planejamento` (design v2, `Planejar.dc.html`, estado `erro`); mesmo padrão
 * de `../hoje/error.tsx`. `captureException` é um no-op seguro sem `Sentry.init` do lado do
 * cliente (etapa 13, decisão 1), já deixando o ponto certo pronto.
 */
export default function ErroPlanejamento({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();
  const hoje = hojeNoClienteISO();
  const segunda = hoje; // A3: a janela começa em hoje
  const domingo = somarDiasISO(segunda, 6);

  useEffect(() => {
    captureException(error);
  }, [error]);

  function tentarDeNovo() {
    iniciarTransicao(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className={hojeStyles.pagina}>
      <BarraTopo titulo={textosPlanejamento.titulo} />
      <div className={hojeStyles.miolo}>
        <CabecaPlanoEstatica tituloPeriodo={tituloSemana(segunda, domingo)} tituloPeriodoCurto={tituloSemanaCurto(segunda, domingo)} />
        <div className={hojeStyles.estadoCartao}>
          <span className={hojeStyles.estadoAviso}>
            <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
            {textosHoje.agenda.planejador.erroAviso}
          </span>
          <h3>{textosHoje.agenda.planejador.erroTitulo}</h3>
          <p>{textosHoje.agenda.planejador.erro}</p>
          <div className={hojeStyles.estadoAcoes}>
            <Botao variante="primario" tamanho="lg" carregando={pendente} onClick={tentarDeNovo}>
              {textosHoje.tentarDeNovo}
            </Botao>
          </div>
        </div>
      </div>
    </div>
  );
}
