import cards from "../../data/cards.json";
import dnc from "../../data/dnc.json";
import { cardImg, cardName } from "./ws-client.js";

const gallery = document.getElementById("gallery")!;

for (const card of cards as { id: string; name: string }[]) {
  const fig = document.createElement("figure");
  fig.innerHTML = `<img src="${cardImg(card.id)}" alt="${card.name}" loading="lazy" /><figcaption>${card.name}</figcaption>`;
  gallery.appendChild(fig);
}

for (const d of dnc as { id: string; name: string }[]) {
  const fig = document.createElement("figure");
  fig.innerHTML = `<img src="${cardImg(d.id)}" alt="${d.name}" loading="lazy" /><figcaption>${d.name}</figcaption>`;
  gallery.appendChild(fig);
}
