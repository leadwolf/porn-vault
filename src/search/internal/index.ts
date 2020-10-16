// TS bindings for Gianna
import Axios from "axios";
import fetch from "node-fetch";

import { getConfig } from "../../config";

export namespace Gianna {
  export interface ISearchResults {
    items: string[];
    // eslint-disable-next-line camelcase
    max_items: number;
    message: string;
    // eslint-disable-next-line camelcase
    num_items: number;
    // eslint-disable-next-line camelcase
    num_pages: number;
    query: string | null;
    status: number;
  }

  export interface ISortOptions {
    // eslint-disable-next-line camelcase
    sort_by: string;
    // eslint-disable-next-line camelcase
    sort_asc: boolean;
    // eslint-disable-next-line camelcase
    sort_type: string;
  }

  export interface IFilterCondition {
    property: string;
    type: string;
    operation: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  }

  export interface IFilterTreeGrouping {
    type: "AND" | "OR" | "NOT";
    children: (IFilterTreeGrouping | IFilterTreeTerminal)[];
  }

  export interface IFilterTreeTerminal {
    condition: IFilterCondition;
  }

  export interface ISearchOptions {
    query?: string;
    take?: number;
    skip?: number;
    filter?: IFilterTreeGrouping | IFilterTreeTerminal;
    sort?: ISortOptions;
  }

  export class Index<T extends { _id: string }> {
    name: string;

    constructor(name: string) {
      this.name = name;
    }

    async count(): Promise<number> {
      // eslint-disable-next-line camelcase
      const res = await Axios.get<{ items_count: number; tokens_count: number }>(
        `http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}`
      );
      return res.data.items_count;
    }

    async times(): Promise<[number, number][]> {
      // eslint-disable-next-line camelcase
      const res = await Axios.get<{ query_times: [number, number][] }>(
        `http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}/times`
      );
      // eslint-disable-next-line camelcase
      return res.data.query_times;
    }

    async clear(): Promise<void> {
      await Axios.delete(
        `http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}/clear`
      );
    }

    async update(items: T[]): Promise<void> {
      await Axios.patch(`http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}`, {
        items,
      });
    }

    async index(items: T[]): Promise<void> {
      await Axios.post(`http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}`, {
        items,
      });
    }

    async remove(items: string[]): Promise<void> {
      const res = await fetch(
        `http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}`,
        {
          headers: {
            "Content-Type": "application/json",
          },
          method: "DELETE",
          body: JSON.stringify({
            items,
          }),
        }
      );
      if (res.ok) {
        return;
      }
      throw new Error(`Request failed: ${res.status}`);
    }

    async search(opts: ISearchOptions): Promise<ISearchResults> {
      try {
        const res = await Axios.post(
          `http://localhost:${getConfig().binaries.giannaPort}/index/${this.name}/search`,
          {
            filter: opts.filter,
            // eslint-disable-next-line camelcase
            sort_by: opts.sort?.sort_by,
            // eslint-disable-next-line camelcase
            sort_asc: opts.sort?.sort_asc,
            // eslint-disable-next-line camelcase
            sort_type: opts.sort?.sort_type,
          },
          {
            params: {
              // hot fix, fix this in gianna eventually TODO:
              q: opts.query ? opts.query.trim().replace(/ {2,}/g, " ") : opts.query,
              take: opts.take,
              skip: opts.skip,
            },
          }
        );
        return res.data as ISearchResults;
      } catch (error) {
        const _err = error as Error;
        console.error(`Search error: ${_err.message}`);
        throw error;
      }
    }
  }

  export async function createIndex(
    name: string,
    fields: string[]
  ): Promise<
    Index<{
      _id: string;
    }>
  > {
    await Axios.put(`http://localhost:${getConfig().binaries.giannaPort}/index/${name}`, {
      fields,
    });
    return new Index(name);
  }
}
