import { iniciaisDe } from "@/lib/iniciais";
import { textosConta } from "@/textos/conta";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";
import { Cartao } from "@/ui/componentes/Cartao";

import { DarAcessoDaEmpresa, TirarAcessoDaEmpresa } from "./GrupoDaConta";
import styles from "./QuemTemAcesso.module.css";

type Props = {
  nomeMarca: string;
  membros: { usuarioId: string; nome: string; email: string; papel?: "dono" | "membro" }[];
  usuarioIdAtual: string;
  /** Convite de grupo: a empresa ativa é do grupo e quem olha é a dona dela, então o rodapé vira o campo de dar acesso e cada membro ganha "Tirar acesso". */
  donoDoGrupo?: boolean;
  /** A empresa ativa é do grupo e quem olha não é a dona: o rodapé diz quem dá o acesso. */
  empresaDoGrupo?: boolean;
};

/**
 * "Quem tem acesso a esta marca" (V3, item 4, Conta.dc.html): só leitura,
 * quem tem acesso é gerenciado pelo admin (item 5, "Dar acesso"/"Tirar o
 * acesso"). Aqui o cliente só vê quem mais entra na marca ativa.
 */
export function QuemTemAcesso({ nomeMarca, membros, usuarioIdAtual, donoDoGrupo = false, empresaDoGrupo = false }: Props) {
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
              {donoDoGrupo && membro.papel !== "dono" ? <TirarAcessoDaEmpresa usuarioId={membro.usuarioId} /> : null}
            </li>
          ))}
        </ul>
      </div>

      {donoDoGrupo ? <DarAcessoDaEmpresa /> : <p className={styles.peAcessos}>{empresaDoGrupo ? textosConviteDeGrupo.pessoas.rodapeMembro : t.rodape}</p>}
    </Cartao>
  );
}
