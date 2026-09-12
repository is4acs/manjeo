import type { Product, Selection } from "./menu";

export type CartLine = { key: string; restaurantId: string; productId: string; name: string; option: string; price: number; quantity: number; productVersion: number; selections: Selection[] };

export function defaultSelections(product: Product): Selection[] {
  return (product.optionGroups || []).map(group => ({ groupId: group.id, choiceIds: group.min === 1 && group.max === 1 ? group.choices.filter(choice => choice.price === 0).slice(0, 1).map(choice => choice.id) : [] }));
}

export function selectionsValid(product: Product, selections: Selection[]): boolean {
  if (!Array.isArray(selections) || selections.some(selection => !selection || typeof selection.groupId !== "string" || !Array.isArray(selection.choiceIds) || selection.choiceIds.some(id => typeof id !== "string"))) return false;
  const groups = product.optionGroups || [];
  if (new Set(selections.map(selection => selection.groupId)).size !== selections.length || selections.some(selection => !groups.some(group => group.id === selection.groupId))) return false;
  return groups.every(group => {
    const ids = selections.find(selection => selection.groupId === group.id)?.choiceIds || [];
    return ids.length >= group.min && ids.length <= group.max && new Set(ids).size === ids.length && ids.every(id => group.choices.some(choice => choice.id === id));
  });
}

export function selectionPrice(product: Product, selections: Selection[]): number {
  return product.price + (product.optionGroups || []).reduce((sum, group) => sum + group.choices.filter(choice => selections.find(selection => selection.groupId === group.id)?.choiceIds.includes(choice.id)).reduce((extra, choice) => extra + choice.price, 0), 0);
}

export function makeLine(restaurantId: string, product: Product, selections: Selection[], quantity: number): CartLine {
  const canonical = selections.filter(selection => selection.choiceIds.length > 0).map(selection => ({ groupId: selection.groupId, choiceIds: [...selection.choiceIds].sort() })).sort((a, b) => a.groupId.localeCompare(b.groupId));
  return {
    key: `${product.id}:${product.version}:${JSON.stringify(canonical)}`,
    restaurantId, productId: product.id, name: product.name, quantity,
    price: selectionPrice(product, canonical), productVersion: product.version, selections: canonical,
    option: (product.optionGroups || []).map(group => {
      const names = group.choices.filter(choice => canonical.find(selection => selection.groupId === group.id)?.choiceIds.includes(choice.id)).map(choice => choice.name);
      return names.length ? `${group.name} : ${names.join(", ")}` : "";
    }).filter(Boolean).join(" · "),
  };
}

export function lineNeedsUpdate(line: CartLine, product?: Product): boolean {
  return !product || product.archived || !product.available || line.productVersion !== product.version || !selectionsValid(product, line.selections) || line.price !== selectionPrice(product, line.selections);
}

export function validStoredLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as CartLine;
  return [line.key, line.restaurantId, line.productId, line.name, line.option].every(text => typeof text === "string") && Number.isInteger(line.price) && line.price >= 0 && Number.isInteger(line.productVersion) && line.productVersion > 0 && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 20 && Array.isArray(line.selections) && line.selections.every(selection => selection && typeof selection.groupId === "string" && Array.isArray(selection.choiceIds) && selection.choiceIds.every(id => typeof id === "string"));
}
