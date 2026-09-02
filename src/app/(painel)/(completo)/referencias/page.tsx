import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Referencias() {
  return (
    <EstadoVazio
      titulo={textosVazio.referencias.titulo}
      descricao={textosVazio.referencias.descricao}
    />
  );
}
