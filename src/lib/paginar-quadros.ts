/**
 * A paginação da imagem 9:16 do roteiro (E26): a página de impressão traz um quadro só, com todas as unidades (uma fala, ou um cartão); este código roda dentro do navegador do Playwright e
 * parte o que não cabe em quadros novos, do mesmo tamanho. É texto (e não uma função) para o empacotador não reescrever o código antes de ele ir para o navegador. Mede o espaço do próprio
 * navegador, com as fontes do painel, em vez de estimar pelo número de letras. Cada quadro leva ao menos uma unidade, então sempre termina.
 *
 * Uma unidade que sozinha passa do espaço (uma fala comprida demais, várias cenas) encolhe a letra do quadro, até 62%, antes de cortar: `--escala` multiplica o corpo da letra no CSS. Só se mesmo
 * assim não couber o quadro conta como cortado. Devolve um JSON com os quadros que ficaram e quantos saíram cortados.
 */
export const PAGINAR_QUADROS = `(() => {
  const primeiro = document.querySelector('[data-quadro]');
  if (!primeiro) return JSON.stringify({ quadros: 0, cortados: 0 });
  const cabeca = primeiro.querySelector('[data-cabeca]');
  const pe = primeiro.querySelector('[data-pe]');
  const modelo = primeiro.querySelector('[data-blocos]');
  const todas = Array.from(modelo.children);

  const excede = (contentor) => contentor.scrollHeight > contentor.clientHeight + 1;
  const encher = (quadro, lista) => {
    const contentor = quadro.querySelector('[data-blocos]');
    contentor.replaceChildren();
    let colocadas = 0;
    for (const unidade of lista) {
      contentor.appendChild(unidade);
      if (colocadas > 0 && excede(contentor)) {
        contentor.removeChild(unidade);
        break;
      }
      colocadas += 1;
    }
    return lista.slice(colocadas);
  };

  const quadros = [primeiro];
  let resto = encher(primeiro, todas);
  while (resto.length > 0) {
    const novo = primeiro.cloneNode(false);
    novo.setAttribute('data-continua', '');
    novo.appendChild(cabeca.cloneNode(true));
    novo.appendChild(modelo.cloneNode(false));
    novo.appendChild(pe.cloneNode(true));
    quadros[quadros.length - 1].after(novo);
    quadros.push(novo);
    resto = encher(novo, resto);
  }

  let cortados = 0;
  quadros.forEach((quadro, indice) => {
    const contentor = quadro.querySelector('[data-blocos]');
    let escala = 1;
    while (excede(contentor) && escala > 0.62) {
      escala -= 0.04;
      contentor.style.setProperty('--escala', String(escala));
    }
    if (excede(contentor)) cortados += 1;
    const numero = quadro.querySelector('[data-pe-pagina]');
    if (numero) numero.textContent = quadros.length > 1 ? (indice + 1) + ' de ' + quadros.length : '';
    const texto = quadro.querySelector('[data-pe-texto]');
    if (texto && indice < quadros.length - 1) texto.textContent = '';
  });
  return JSON.stringify({ quadros: quadros.length, cortados });
})()`;

/** Quantos quadros no máximo uma imagem de roteiro leva: acima disso o pedido falha em vez de gerar dezenas de PNGs de 1080 por 1920. */
export const MAXIMO_DE_QUADROS = 20;
