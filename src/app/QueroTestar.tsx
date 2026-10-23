"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { queroTestarAction } from "./acoes";
import styles from "./page.module.css";

/** Os textos chegam do servidor (a página os lê de `src/textos/interessados.ts`): o arquivo de textos importa a configuração, que não vai para o navegador. */
export type TextosDoFormulario = {
  titulo: string;
  subtitulo: string;
  nome: { rotulo: string; marcador: string };
  email: { rotulo: string; marcador: string };
  whatsapp: { rotulo: string; ajuda: string; marcador: string };
  ramo: { rotulo: string; ajuda: string; marcador: string };
  aceiteAntes: string;
  aceiteLink: string;
  aceiteDepois: string;
  privacidade: string;
  botao: string;
  enviando: string;
  sucessoTitulo: string;
  sucessoTexto: string;
  erroGenerico: string;
  semConexao: string;
};

type Erros = Partial<Record<"nome" | "email" | "whatsapp" | "ramo" | "aceite", string>>;

/**
 * O formulário "Quero testar" (E57a). Sem `required` do navegador (`noValidate`): quem valida é o servidor, e o texto do erro é o do produto. `method="post"` de propósito: se a
 * página ainda não carregou o JavaScript e a pessoa tocar no botão, o envio nativo nunca põe nome, e-mail e telefone na barra de endereço. O campo "site" é a armadilha de robô:
 * escondido de quem vê e de quem usa leitor de tela, fora da ordem do Tab.
 */
export function QueroTestar({ textos }: { textos: TextosDoFormulario }) {
  const tratarFalha = useTratarFalha();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [ramo, setRamo] = useState("");
  const [aceite, setAceite] = useState(false);
  const [site, setSite] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const refAceite = useRef<HTMLInputElement>(null);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErros({});
    setErroGeral(null);
    setEnviando(true);
    try {
      const resultado = await queroTestarAction({ nome, email, whatsapp, ramo, aceite, site });
      if (resultado.ok) {
        setEnviado(true);
        return;
      }
      if (resultado.erros) {
        setErros(resultado.erros);
        if (resultado.erros.aceite && !resultado.erros.nome && !resultado.erros.email && !resultado.erros.whatsapp && !resultado.erros.ramo) refAceite.current?.focus();
      } else {
        setErroGeral(resultado.erro ?? textos.erroGenerico);
      }
    } catch (falha) {
      setErroGeral(tratarFalha(falha, textos.erroGenerico, textos.semConexao));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className={styles.sucesso} role="status">
        <h3 className={styles.sucessoTitulo}>{textos.sucessoTitulo}</h3>
        <p className={styles.sucessoTexto}>{textos.sucessoTexto}</p>
      </div>
    );
  }

  return (
    <form className={styles.formulario} method="post" noValidate onSubmit={enviar} aria-label={textos.titulo}>
      <Campo rotulo={textos.nome.rotulo} name="nome" autoComplete="name" placeholder={textos.nome.marcador} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} />
      <Campo
        rotulo={textos.email.rotulo}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={textos.email.marcador}
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        erro={erros.email}
      />
      <Campo
        rotulo={textos.whatsapp.rotulo}
        ajuda={textos.whatsapp.ajuda}
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={textos.whatsapp.marcador}
        maxLength={30}
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        erro={erros.whatsapp}
      />
      <Campo
        rotulo={textos.ramo.rotulo}
        ajuda={textos.ramo.ajuda}
        name="ramo"
        autoComplete="off"
        placeholder={textos.ramo.marcador}
        maxLength={80}
        value={ramo}
        onChange={(e) => setRamo(e.target.value)}
        erro={erros.ramo}
      />
      <div className={styles.armadilha} aria-hidden="true">
        <label>
          Site
          <input type="text" name="site" tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
      </div>
      <div className={styles.aceite}>
        <label className={styles.aceiteLinha}>
          <input ref={refAceite} type="checkbox" name="aceite" checked={aceite} onChange={(e) => setAceite(e.target.checked)} aria-invalid={Boolean(erros.aceite)} />
          <span>
            {textos.aceiteAntes}
            <Link href="/privacidade" className={styles.link}>
              {textos.aceiteLink}
            </Link>
            {textos.aceiteDepois}
          </span>
        </label>
        {erros.aceite ? (
          <p className={styles.erroAviso} role="alert">
            {erros.aceite}
          </p>
        ) : null}
      </div>
      <p className={styles.nota}>{textos.privacidade}</p>
      {erroGeral ? (
        <p className={styles.erroAviso} role="alert">
          {erroGeral}
        </p>
      ) : null}
      <Botao type="submit" tamanho="lg" carregando={enviando} precisaDeRede>
        {enviando ? textos.enviando : textos.botao}
      </Botao>
    </form>
  );
}
