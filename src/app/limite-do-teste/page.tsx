import { X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LIMITES_DA_EDICAO } from "@/config/edicao";
import { sessaoAtual } from "@/lib/sessao";
import { textosCadastro } from "@/textos/cadastro";

import { BotaoAssinarAgora } from "./BotaoAssinarAgora";
import styles from "./page.module.css";

/**
 * "Os 10 roteiros do teste acabaram" e "As 3 edições do teste acabaram" (E63 PR 2, o desenho de `LimiteDoTeste.dc.html`): para onde a ação que bateu no teto leva. `?o=` escolhe a
 * face (roteiros, edicoes); qualquer outro valor cai na face geral. Não é erro, é escolha: o número em mono, sem vermelho, o que a pessoa ainda tem sem pagar, o preço antes do botão, e
 * "Agora não" para voltar sem perder nada. Os números do teste vêm de `TETO_DO_TESTE`.
 */
export default async function LimiteDoTeste({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const { o } = await searchParams;
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const t = textosCadastro.limiteDoTeste;
  const face =
    o === "roteiros"
      ? { titulo: t.tituloRoteiros, contador: t.contadorRoteiros, continuar: t.paraContinuarRoteiros, ainda: t.aindaTemRoteiros }
      : o === "edicoes"
        ? { titulo: t.tituloEdicoes, contador: t.contadorEdicoes, continuar: t.paraContinuarEdicoes(LIMITES_DA_EDICAO.edicoesPorMes), ainda: t.aindaTemEdicoes }
        : { titulo: t.tituloUso, contador: t.contadorUso, continuar: t.paraContinuarUso, ainda: t.aindaTemUso };

  return (
    <div className={styles.pagina}>
      <div className={styles.veu} aria-hidden="true" />
      <div className={styles.folha} role="dialog" aria-modal="true" aria-labelledby="titulo-limite">
        <div className={styles.topo}>
          <span className={styles.alca} aria-hidden="true" />
          <h1 className={styles.titulo} id="titulo-limite">
            {face.titulo}
          </h1>
          <Link href="/hoje" className={styles.fechar} aria-label={t.fechar}>
            <X aria-hidden="true" strokeWidth={1.5} />
          </Link>
        </div>

        <div className={styles.corpo}>
          <p className={styles.contador}>
            <b>{face.contador.numero}</b>
            {face.contador.texto}
          </p>
          <p className={styles.texto}>{face.continuar}</p>
          <p className={styles.suave}>{face.ainda}</p>

          <div className={styles.plano}>
            <span className={styles.rotulo}>{t.plano.rotulo}</span>
            <p className={styles.preco}>
              <b>{t.plano.valor}</b>
              <span>{t.plano.porMes}</span>
            </p>
            <p>{t.plano.cobranca}</p>
            <p>{t.plano.cancelar}</p>
          </div>
        </div>

        <div className={styles.pe}>
          <BotaoAssinarAgora rotulo={t.botao} />
          <Link href="/hoje" className={styles.agoraNao}>
            {t.agoraNao}
          </Link>
          <p className={styles.miudo}>{t.stripe}</p>
        </div>
      </div>
    </div>
  );
}
