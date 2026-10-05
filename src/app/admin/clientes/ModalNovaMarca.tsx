"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";
import { Campo } from "@/ui/componentes/Campo";

import { criarMarcaAction } from "./acoes";
import styles from "./ModalNovaMarca.module.css";

const t = textosAdmin.clientes;

type Props = {
  aberto: boolean;
  onFechar: () => void;
};

/**
 * "Nova conta" (V12b, item 2): só o que é da conta, nome, ramo, tipo de
 * conteúdo e roteiros por dia, sem e-mail. O ramo vem da mesma busca instantânea do
 * Começar (o catálogo de ramos, E45): o setor dele nasce ao criar a conta quando ainda
 * não existe, e "Não achei o ramo" deixa o admin escrever o ramo com as próprias palavras. Ao criar, sai desta tela para
 * `/admin/clientes/[id]`, onde "Quem tem acesso" está vazio e "dar acesso"
 * em destaque é o próximo passo (a pessoa entra depois, dentro da marca).
 */
export function ModalNovaMarca({ aberto, onFechar }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [ramoSlug, setRamoSlug] = useState<string | null>(null);
  /** "Não achei o ramo": o texto escrito à mão (nulo: o ramo é o da lista). */
  const [ramoOutro, setRamoOutro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [tipo, setTipo] = useState<"negocio" | "pessoa">("negocio");
  const [plano, setPlano] = useState<"padrao" | "sem_limite">("padrao");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    setTentou(true);
    const escrito = ramoOutro?.trim() ?? "";
    if (!ramoSlug && !escrito) return;
    setCriando(true);
    setErro(null);
    try {
      const resultado = await criarMarcaAction({ nome, ramoSlug: ramoOutro === null ? ramoSlug : null, ramoOutro: ramoOutro === null ? null : escrito, tipo, plano });
      if (!resultado.ok) {
        setErro(resultado.erro || t.erroCriar);
        setCriando(false);
        return;
      }
      onFechar();
      router.push(`/admin/clientes/${resultado.dado.id}`);
    } catch {
      setErro(t.erroCriar);
      setCriando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className={styles.backdrop} onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.modalTitulo}
        className={styles.painel}
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 className={styles.titulo}>{t.modalTitulo}</h2>
        <form className={styles.forma} onSubmit={criar}>
          <Campo rotulo={t.campoNome} required value={nome} onChange={(e) => setNome(e.target.value)} />
          <div className={styles.campoRamo}>
            <BuscaDeRamo
              rotulo={t.campoNicho}
              ajuda={t.ajudaRamo}
              valor={ramoOutro === null ? ramoSlug : null}
              nomeForaDoCatalogo={ramoOutro !== null ? t.naoAcheiRamo : null}
              textoNaoAchei={t.naoAcheiRamo}
              erro={tentou && !ramoSlug && ramoOutro === null ? t.ramoObrigatorio : undefined}
              onEscolher={(slug) => {
                setRamoSlug(slug);
                setRamoOutro(null);
              }}
              onNaoAchei={(digitado) => {
                setRamoSlug(null);
                setRamoOutro(digitado || ramoOutro || "");
              }}
            />
          </div>
          {ramoOutro !== null ? (
            <Campo
              rotulo={t.campoRamoOutro}
              ajuda={t.ajudaRamoOutro}
              value={ramoOutro}
              onChange={(e) => setRamoOutro(e.target.value)}
              erro={tentou && ramoOutro.trim().length === 0 ? t.ramoObrigatorio : undefined}
            />
          ) : null}
          <label className={styles.rotuloSelect}>
            {t.campoTipo}
            <select
              className={styles.select}
              aria-label={t.campoTipo}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "negocio" | "pessoa")}
            >
              <option value="negocio">{t.tipoNegocio}</option>
              <option value="pessoa">{t.tipoPessoa}</option>
            </select>
          </label>
          <label className={styles.rotuloSelect}>
            {t.campoPlano}
            <select
              className={styles.select}
              aria-label={t.campoPlano}
              value={plano}
              onChange={(e) => setPlano(e.target.value as "padrao" | "sem_limite")}
            >
              <option value="padrao">{t.planoPadrao}</option>
              <option value="sem_limite">{t.planoSemLimite}</option>
            </select>
          </label>
          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
          <Botao type="submit" tamanho="lg" carregando={criando}>
            {criando ? t.criando : t.botaoCriar}
          </Botao>
        </form>
      </div>
    </div>
  );
}
