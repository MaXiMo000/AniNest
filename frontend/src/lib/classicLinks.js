import { escapeHtml } from './ui.js';

// Anime made from public-domain books, both ways: "Read the original" on an
// anime page and "Watch the anime" in the reader. Hand-picked; anime ids are
// MyAnimeList ids, book ids are Project Gutenberg ebook numbers.
// Each entry: { anime: [[malId, title]], books: [[gutenbergId, title, author]], note }.
export const CLASSIC_LINKS = [
  { anime: [[239, 'Gankutsuou: The Count of Monte Cristo']], books: [[1184, 'The Count of Monte Cristo', 'Alexandre Dumas']], note: 'A far-future retelling of Dumas’s revenge story.' },
  { anime: [[1695, 'Les Misérables: Shoujo Cosette']], books: [[135, 'Les Misérables', 'Victor Hugo']], note: 'Hugo’s novel, told through Cosette’s eyes.' },
  { anime: [[270, 'Hellsing'], [777, 'Hellsing Ultimate']], books: [[345, 'Dracula', 'Bram Stoker']], note: 'Alucard and the Van Hellsing family come straight out of Stoker’s novel.' },
  { anime: [[31478, 'Bungo Stray Dogs']], books: [[1982, '羅生門 (Rashōmon)', 'Ryūnosuke Akutagawa'], [2147, 'The Works of Edgar Allan Poe, Vol. 1', 'Edgar Allan Poe'], [2554, 'Crime and Punishment', 'Fyodor Dostoyevsky'], [64317, 'The Great Gatsby', 'F. Scott Fitzgerald'], [2701, 'Moby Dick', 'Herman Melville']], note: 'Its characters are named after real writers, and their powers after their books.' },
  { anime: [[40911, 'Moriarty the Patriot']], books: [[834, 'The Memoirs of Sherlock Holmes', 'Arthur Conan Doyle'], [244, 'A Study in Scarlet', 'Arthur Conan Doyle']], note: 'Holmes’s great enemy as the hero; “The Final Problem” is in the Memoirs.' },
  { anime: [[1972, 'Sherlock Hound']], books: [[1661, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle']], note: 'Holmes as a dog, with episodes drawn from Doyle’s stories.' },
  { anime: [[283, 'Anne of Green Gables'], [60334, 'Anne Shirley']], books: [[45, 'Anne of Green Gables', 'L. M. Montgomery']], note: 'A faithful adaptation of Montgomery’s novel.' },
  { anime: [[2225, 'Heidi, Girl of the Alps']], books: [[1448, 'Heidi', 'Johanna Spyri']], note: 'The 1974 series made from Spyri’s novel.' },
  { anime: [[2547, 'A Little Princess Sara']], books: [[146, 'A Little Princess', 'Frances Hodgson Burnett']], note: 'Sara Crewe’s story from Burnett’s novel.' },
  { anime: [[2548, 'Tales of Little Women']], books: [[514, 'Little Women', 'Louisa May Alcott']], note: 'The March sisters, from Alcott’s novel.' },
  { anime: [[2558, 'Little Women II: Jo’s Boys']], books: [[2788, 'Little Men', 'Louisa May Alcott']], note: 'Jo’s school at Plumfield, from Little Men.' },
  { anime: [[2577, 'The Adventures of Tom Sawyer']], books: [[74, 'The Adventures of Tom Sawyer', 'Mark Twain']], note: 'Twain’s novel as a 1980 series.' },
  { anime: [[2545, 'Huckleberry no Bouken']], books: [[76, 'Adventures of Huckleberry Finn', 'Mark Twain']], note: 'Huck and Jim down the Mississippi.' },
  { anime: [[2826, 'The Wonderful Wizard of Oz']], books: [[55, 'The Wonderful Wizard of Oz', 'L. Frank Baum']], note: 'Baum’s Oz books as a 1986 series.' },
  { anime: [[2618, 'Treasure Island']], books: [[120, 'Treasure Island', 'Robert Louis Stevenson']], note: 'Osamu Dezaki’s take on Stevenson’s pirate story.' },
  { anime: [[1251, 'Nadia: The Secret of Blue Water']], books: [[164, 'Twenty Thousand Leagues under the Sea', 'Jules Verne']], note: 'Loosely inspired by Verne: Captain Nemo and the Nautilus included.' },
  { anime: [[1638, 'Peter Pan & Wendy']], books: [[16, 'Peter Pan', 'J. M. Barrie']], note: 'Barrie’s Neverland as a 1989 series.' },
  { anime: [[2567, 'Piccolino no Bouken']], books: [[500, 'The Adventures of Pinocchio', 'Carlo Collodi']], note: 'Collodi’s wooden puppet, renamed.' },
  { anime: [[2569, 'The Jungle Book']], books: [[236, 'The Jungle Book', 'Rudyard Kipling']], note: 'Mowgli’s stories from Kipling.' },
  { anime: [[2543, 'The Great Adventures of Robin Hood']], books: [[10148, 'The Merry Adventures of Robin Hood', 'Howard Pyle']], note: 'The Sherwood legends, told for young readers.' },
  { anime: [[2544, 'Swiss Family Robinson']], books: [[3836, 'Swiss Family Robinson', 'Johann David Wyss']], note: 'A shipwrecked family, from Wyss’s novel.' },
  { anime: [[2333, 'The Three Musketeers']], books: [[1257, 'The Three Musketeers', 'Alexandre Dumas']], note: 'D’Artagnan and friends, from Dumas.' },
  { anime: [[1699, 'Romeo x Juliet']], books: [[1513, 'Romeo and Juliet', 'William Shakespeare']], note: 'A fantasy reimagining of Shakespeare’s play.' },
  { anime: [[2828, 'Nobody’s Boy Remi'], [2829, 'Remi, Nobody’s Girl']], books: [[25102, 'Nobody’s Boy (Sans famille)', 'Hector Malot']], note: 'Malot’s novel of a travelling orphan.' },
  { anime: [[5155, 'Tale of Genji']], books: [[66057, 'The Tale of Genji', 'Murasaki Shikibu']], note: 'The thousand-year-old classic of the Heian court.' },
  { anime: [[2572, 'Alice in Wonderland']], books: [[11, 'Alice’s Adventures in Wonderland', 'Lewis Carroll']], note: 'Carroll’s Wonderland as a 1983 series.' },
  { anime: [[2553, 'A Dog of Flanders'], [2624, 'A Dog of Flanders: My Patrasche']], books: [[7766, 'A Dog of Flanders', 'Ouida']], note: 'Nello and Patrasche, from Ouida’s story.' },
  { anime: [[1663, '3000 Leagues in Search of Mother']], books: [[28961, 'Cuore (Heart)', 'Edmondo De Amicis']], note: 'Marco’s journey is one of the stories told in Cuore.' },
];

export const booksForAnime = (malId) => CLASSIC_LINKS.filter((l) => l.anime.some(([id]) => id === Number(malId)));
export const animeForBook = (bookId) => CLASSIC_LINKS.filter((l) => l.books.some(([id]) => id === Number(bookId)));

const cover = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

// "Read the original" section for an anime page; '' when there is none.
export function readOriginalHTML(malId) {
  const links = booksForAnime(malId);
  if (!links.length) return '';
  return `
    <section class="section classic-links">
      <div class="section-head">
        <h2 class="section-title">📜 Read the Original</h2>
        <span class="section-sub">${escapeHtml(links[0].note)} Free and public domain, right here.</span>
      </div>
      <div class="classic-link-row">${links.flatMap((l) => l.books).map(([id, title, author]) => `
        <a class="classic-link" href="#/read/${id}">
          <img src="${cover(id)}" alt="" loading="lazy" />
          <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(author)} · Read free →</small></span>
        </a>`).join('')}</div>
    </section>`;
}

// "Watch the anime" line for the reader; '' when there is none.
export function watchAnimeHTML(bookId) {
  const links = animeForBook(bookId);
  if (!links.length) return '';
  return `
    <p class="reader-anime">📺 On screen: ${links.flatMap((l) => l.anime).map(([id, title]) => `<a href="#/anime/${id}">${escapeHtml(title)}</a>`).join(', ')}.
      <span class="muted-note">${escapeHtml(links[0].note)}</span></p>`;
}

// "From Anime to the Page" shelf for Read Free: one book per anime.
export function animeToPageHTML() {
  return `
    <section class="section classic-links">
      <div class="section-head">
        <h2 class="section-title">📺 From Anime to the Page</h2>
        <span class="section-sub">Read the public-domain books your favorite anime came from.</span>
      </div>
      <div class="classic-link-row">${CLASSIC_LINKS.map((l) => {
    const [id, title] = l.books[0];
    return `
        <a class="classic-link" href="#/read/${id}">
          <img src="${cover(id)}" alt="" loading="lazy" />
          <span><strong>${escapeHtml(title)}</strong><small>📺 ${escapeHtml(l.anime[0][1])}</small></span>
        </a>`;
  }).join('')}</div>
    </section>`;
}
