/** Same NFD + combining-mark removal as PostgreSQL search_text. */
export const searchText = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
