import { iniciaisDe } from "@/lib/iniciais";
import { textosConta } from "@/textos/conta";
import { Cartao } from "@/ui/componentes/Cartao";

import styles from "./QuemTemAcesso.module.css";

type Props = {
  nomeMarca: string;
  membros: { usuarioId: string; nome: string; email: string }[];
  usuarioIdAtual: string;
};

/**
 * "Quem tem acesso a esta marca" (V3, item 4, Conta.dc.html): só leitura,
 * quem tem acesso é gerenciado pelo admin (item 5, "Dar acesso"/"Tirar o
 * acesso"). Aqui o cliente só vê quem mais entra na marca ativa.
 */
export function QuemTemAcesso({ nomeMarca, membros, usuarioIdAtual }: Props) {
  const t = textosConta.acessos;
  const umaPessoaSo = membros.length <= 1;

  return (
    <Cartao className={styles.acessos}>
      <div className={styles.cabeca}>
        <h3 className={styles.titulo}>{t.titulo}</h3>
        <span className={styles.marcaDaVez}>
          <span className={styles.avatar} aria-hidden="true">
            {iniciaisDe(nomeMarca)}
          </span>
          <span>{nomeMarca}</span>
        </span>
      </div>

      <p className={styles.explica}>{umaPessoaSo ? t.explicaUmaPessoa : t.explica}</p>

      <div>
        <div className={styles.cabecaLista}>
          <span className={styles.rotulo}>{t.contagem(membros.length)}</span>
        </div>
        <ul className={styles.pessoas}>
          {membros.map((membro) => (
            <li key={membro.usuarioId} className={styles.pessoa}>
              <span className={styles.avatarNeutro} aria-hidden="true">
                {iniciaisDe(membro.nome)}
              </span>
              <span className={styles.quem}>
                <span className={styles.nome}>
                  {membro.nome}
                  {membro.usuarioId === usuarioIdAtual ? <span className={styles.voce}>{t.voce}</span> : null}
                </span>
                <span className={styles.email}>{membro.email}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className={styles.peAcessos}>{t.rodape}</p>
    </Cartao>
  );
}
