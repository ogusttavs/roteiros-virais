/**
 * As definições dos oito tipos de abertura (V4, roteiro sem vício, escopo
 * 5.12, item 5), compartilhadas por `extrairVideo.ts` (classifica o vídeo
 * coletado) e `classificarAbertura.ts` (classifica em lote o que já está no
 * banco, `scripts/preencher-tipo-abertura.ts`, item 2): as duas tarefas
 * precisam da mesma régua, e duplicar o texto arriscaria as duas divergirem
 * numa rodada futura. Fica fora de `enums.ts` porque é texto de prompt de
 * verdade (frase inteira, não rótulo curto), então mora dentro de
 * `src/ia/prompts/`, que o `checar-texto` varre como qualquer outro prompt.
 */
export function definicoesTipoAbertura(): string {
  return `- cena: começa mostrando uma cena acontecendo, sem falar primeiro.
- resultado: começa mostrando ou dizendo o resultado final, antes de explicar como chegou lá.
- objeto: começa com um objeto, produto ou ferramenta em destaque na tela.
- fala_direta: começa com a pessoa falando direto para a câmera, uma frase afirmativa, sem
  cena, sem pergunta.
- numero: começa com um número ou dado concreto na primeira frase.
- contraste: começa mostrando ou dizendo um antes e depois, ou dois jeitos diferentes de
  fazer a mesma coisa.
- pergunta: começa com uma pergunta direta para quem assiste.
- outro: nenhum dos anteriores descreve o começo deste vídeo.

Regra de desempate quando mais de um tipo parece caber: vale o que aparece ou se ouve
primeiro nos 3 segundos iniciais, nunca a intenção do resto do vídeo.`;
}
