/**
 * Regra da etapa 18, decisao 5 do `PROXIMO.md`: todo arquivo de
 * `src/ia/prompts/` que mudou em relacao a `main` precisa trocar
 * `export const versao`, senao o conjunto de referencia (golden set) nao
 * teria como saber que o prompt e outro. Sem I/O aqui (git, arquivo), para
 * dar para testar; o ponto de entrada de linha de comando fica em
 * checar-versao-prompt.ts.
 */
const PADRAO_VERSAO = /export const versao = "([^"]+)"/;

export function extrairVersao(conteudo: string): string | null {
  return conteudo.match(PADRAO_VERSAO)?.[1] ?? null;
}

export type ArquivoPrompt = {
  caminho: string;
  /** Conteudo em `origin/main`; null se o arquivo nao existia la (arquivo novo). */
  antigo: string | null;
  /** Conteudo atual; null se o arquivo foi apagado (nada a verificar). */
  novo: string | null;
};

/**
 * Arquivo novo (sem `antigo`) ou apagado (sem `novo`) nunca e problema: so
 * importa quando o MESMO arquivo existia nos dois lados e o conteudo mudou
 * sem a versao mudar junto.
 */
export function verificarVersoesDePrompt(arquivos: ArquivoPrompt[]): string[] {
  const problemas: string[] = [];
  for (const arquivo of arquivos) {
    if (arquivo.antigo === null || arquivo.novo === null) continue;
    if (arquivo.antigo === arquivo.novo) continue;

    const versaoAntiga = extrairVersao(arquivo.antigo);
    const versaoNova = extrairVersao(arquivo.novo);
    if (versaoAntiga === versaoNova) {
      problemas.push(
        `${arquivo.caminho}: mudou sem trocar a versao (${versaoNova ?? "nenhuma versao encontrada"})`,
      );
    }
  }
  return problemas;
}
