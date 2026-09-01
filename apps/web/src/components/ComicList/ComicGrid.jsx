import { ComicCard, ComicRow } from './ComicCard.jsx';

/**
 * Grid/list komik. Phase 1 pakai pagination + lazy image;
 * virtual scrolling (react-window) masuk Phase 3 saat koleksi >1000.
 */
export const ComicGrid = ({ comics = [], viewMode = 'grid' }) => {
  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-2">
        {comics.map((comic) => (
          <ComicRow key={comic.id} comic={comic} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid-komik">
      {comics.map((comic) => (
        <ComicCard key={comic.id} comic={comic} />
      ))}
    </div>
  );
};

export default ComicGrid;
