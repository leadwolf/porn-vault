import { VuexModule, Module, Mutation } from "vuex-class-modules";
import IScene from "@/types/scene";
import IActor from "@/types/actor";
import IMovie from "@/types/movie";

@Module
class MovieModule extends VuexModule {
  current = null as IMovie | null;

  page = 1;
  numResults = 0;
  numPages = 0;

  @Mutation
  resetPagination() {
    this.numPages = 0;
    this.numResults = 0;
    this.page = 1;
  }

  @Mutation
  setPage(num: number) {
    this.page = num;
  }

  @Mutation
  setPagination({ numResults, numPages }: { numResults: number; numPages: number }) {
    this.numResults = numResults;
    this.numPages = numPages;
  }

  @Mutation
  setName(name: string) {
    if (this.current) this.current.name = name;
  }

  @Mutation
  setDescription(description: string) {
    if (this.current) this.current.description = description;
  }

  @Mutation
  setCurrent(current: IMovie | null) {
    this.current = current;
  }

  @Mutation
  setFavorite(bool: boolean) {
    if (this.current) this.current.favorite = bool;
  }

  @Mutation
  setRating(num: number) {
    if (this.current) this.current.rating = num;
  }

  @Mutation
  setBookmark(bool: number | null) {
    if (this.current) this.current.bookmark = bool;
  }

  @Mutation
  setFrontCover(id: string) {
    if (this.current) {
      if (!this.current.frontCover) this.current.frontCover = { _id: id, color: null };
      else this.current.frontCover._id = id;
    }
  }

  @Mutation
  setBackCover(id: string) {
    if (this.current) {
      if (!this.current.backCover) this.current.backCover = { _id: id };
      else this.current.backCover._id = id;
    }
  }

  @Mutation
  setSpineCover(id: string) {
    if (this.current) {
      if (!this.current.spineCover) this.current.spineCover = { _id: id };
      else this.current.spineCover._id = id;
    }
  }

  @Mutation
  setActors(actors: IActor[]) {
    if (this.current) this.current.actors = actors;
  }

  @Mutation
  setScenes(scenes: IScene[]) {
    if (this.current) this.current.scenes = scenes;
  }

  @Mutation
  setDuration(dur: number) {
    if (this.current) this.current.duration = dur;
  }

  @Mutation
  setStudio(studio: any) {
    if (this.current) this.current.studio = studio;
  }

  @Mutation
  setSize(size: number) {
    if (this.current) this.current.size = size;
  }

  @Mutation
  setReleaseDate(val: number | null) {
    if (this.current) this.current.releaseDate = val;
  }

  @Mutation
  setLabels(labels: any) {
    if (this.current) this.current.labels = labels;
  }
}

import store from "./index";
export const movieModule = new MovieModule({ store, name: "movies" });
