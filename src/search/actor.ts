import { getClient, indexMap } from "../search";
import Actor from "../types/actor";
import { getNationality } from "../types/countries";
import Scene from "../types/scene";
import Studio from "../types/studio";
import { mapAsync } from "../utils/async";
import { logger } from "../utils/logger";
import {
  arrayFilter,
  bookmark,
  buildCustomFilter,
  CustomFieldFilter,
  excludeFilter,
  favorite,
  getCount,
  getPage,
  getPageSize,
  includeFilter,
  ISearchResults,
  normalizeAliases,
  ratingFilter,
  searchQuery,
  shuffle,
  sort,
} from "./common";
import { addSearchDocs, buildIndex, indexItems, ProgressCallback } from "./internal/buildIndex";

export interface IActorSearchDoc {
  id: string;
  addedOn: number;
  name: string;
  aliases: string[];
  labels: string[];
  numLabels: number;
  labelNames: string[];
  rating: number;
  averageRating: number;
  score: number;
  bookmark: number | null;
  favorite: boolean;
  numViews: number;
  bornOn: number | null;
  numScenes: number;
  nationalityName: string | null;
  countryCode: string | null;
  custom: Record<string, boolean | string | number | string[] | null>;
  studios: string[];
  studioNames: string[];
}

export async function createActorSearchDoc(actor: Actor): Promise<IActorSearchDoc> {
  const labels = await Actor.getLabels(actor);

  const numViews = (await Actor.getWatches(actor)).length;
  const numScenes = (await Scene.getByActor(actor._id)).length;

  const nationality = actor.nationality ? getNationality(actor.nationality) : null;

  const baseStudios = await Actor.getStudioFeatures(actor);
  const studios = [...new Set((await mapAsync(baseStudios, Studio.getParents)).flat())];

  return {
    id: actor._id,
    addedOn: actor.addedOn,
    name: actor.name,
    aliases: normalizeAliases(actor.aliases),
    labels: labels.map((l) => l._id),
    numLabels: labels.length,
    labelNames: labels.map((l) => l.name),
    score: Actor.calculateScore(actor, numViews, numScenes),
    rating: actor.rating,
    averageRating: await Actor.getAverageRating(actor),
    bookmark: actor.bookmark,
    favorite: actor.favorite,
    numViews,
    bornOn: actor.bornOn,
    numScenes,
    nationalityName: nationality ? nationality.nationality : null,
    countryCode: nationality ? nationality.alpha2 : null,
    custom: actor.customFields,
    studios: studios.map((st) => st._id),
    studioNames: studios.map((st) => st.name),
  };
}

export async function removeActor(actorId: string): Promise<void> {
  await getClient().delete({
    index: indexMap.actors,
    id: actorId,
    type: "_doc",
  });
}

export async function removeActors(actorIds: string[]): Promise<void> {
  await mapAsync(actorIds, removeActor);
}

export async function indexActors(actors: Actor[], progressCb?: ProgressCallback): Promise<number> {
  logger.verbose(`Indexing ${actors.length} actors`);
  return indexItems(actors, createActorSearchDoc, addActorSearchDocs, progressCb);
}

async function addActorSearchDocs(docs: IActorSearchDoc[]): Promise<void> {
  return addSearchDocs(indexMap.actors, docs);
}

export async function buildActorIndex(): Promise<void> {
  await buildIndex(indexMap.actors, Actor.getAll, indexActors);
}

export interface IActorSearchQuery {
  query: string;
  favorite?: boolean;
  bookmark?: boolean;
  rating: number;
  include?: string[];
  exclude?: string[];
  nationality?: string;
  sortBy?: string;
  sortDir?: string;
  skip?: number;
  take?: number;
  page?: number;
  studios?: string[];
  custom?: CustomFieldFilter[];
}

function nationalityFilter(countryCode: string | undefined) {
  if (countryCode) {
    return [
      {
        match: {
          countryCode,
        },
      },
    ];
  }
  return [];
}

export async function searchActors(
  options: Partial<IActorSearchQuery>,
  shuffleSeed = "default",
  extraFilter: unknown[] = []
): Promise<ISearchResults> {
  logger.verbose(`Searching actors for '${options.query || "<no query>"}'...`);

  const count = await getCount(indexMap.actors);
  if (count === 0) {
    logger.debug(`No items in ES, returning 0`);
    return {
      items: [],
      numPages: 0,
      total: 0,
    };
  }

  const result = await getClient().search<IActorSearchDoc>({
    index: indexMap.actors,
    ...getPage(options.page, options.skip, options.take),
    body: {
      ...sort(options.sortBy, options.sortDir, options.query),
      track_total_hits: true,
      query: {
        bool: {
          must: [
            ...shuffle(shuffleSeed, options.sortBy),
            ...searchQuery(options.query, ["name^1.5", "labelNames", "nationalityName^0.75"]),
          ],
          filter: [
            ...ratingFilter(options.rating),
            ...bookmark(options.bookmark),
            ...favorite(options.favorite),

            ...includeFilter(options.include),
            ...excludeFilter(options.exclude),

            ...arrayFilter(options.studios, "studios", "OR"),

            ...nationalityFilter(options.nationality),

            ...buildCustomFilter(options.custom),

            ...extraFilter,
          ],
        },
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const total: number = result.hits.total.value;

  return {
    items: result.hits.hits.map((doc) => doc._source.id),
    total,
    numPages: Math.ceil(total / getPageSize(options.take)),
  };
}
