import { LitElement, html, css, property } from "lit-element";
import { filter_entity } from "./filter";
import pjson from "../package.json";
import { AutoEntitiesConfig, HACard } from "./types";
import { bind_template, unbind_template } from "./templates";
import { hasTemplate } from "card-tools/src/templates";
import { get_sorter } from "./sort";

function compare_deep(a: any, b: any) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!(a instanceof Object && b instanceof Object)) return false;
  for (const x in a) {
    if (!a.hasOwnProperty(x)) continue;
    if (!b.hasOwnProperty(x)) return false;
    if (a[x] === b[x]) continue;
    if (typeof a[x] !== "object") return false;
    if (!compare_deep(a[x], b[x])) return false;
  }
  for (const x in b) {
    if (!b.hasOwnProperty(x)) continue;
    if (!a.hasOwnProperty(x)) return false;
  }
  return true;
}

class AutoEntities extends LitElement {
  _config: AutoEntitiesConfig;
  @property() hass: any;
  @property() card: HACard;
  @property() _template: string[];
  _entities;
  _renderer;

  setConfig(config: AutoEntitiesConfig) {
    if (!config) {
      throw new Error("No configuration.");
    }
    if (!config.card?.type) {
      throw new Error("No card type specified.");
    }
    if (!config.filter && !config.entities) {
      throw new Error("No filters specified.");
    }
    config = JSON.parse(JSON.stringify(config));
    this._config = config;

    this._renderer = (tpl) => (this._template = tpl);
    if (
      this._config.filter?.template &&
      hasTemplate(this._config.filter.template)
    ) {
      bind_template(this._renderer, this._config.filter.template, { config });
    }
  }

  connectedCallback() {
    super.connectedCallback();
    if (
      this._config?.filter?.template &&
      hasTemplate(this._config.filter.template)
    ) {
      bind_template(this._renderer, this._config.filter.template, {
        config: this._config,
      });
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    unbind_template(this._renderer);
  }

  async update_card(entities: any) {
    if (this._entities && compare_deep(entities, this._entities)) return;
    this._entities = entities;
    const cardConfig = {
      [this._config.card_param || "entities"]: entities,
      ...this._config.card,
    };
    if (!this.card) {
      const helpers = await (window as any).loadCardHelpers();
      this.card = await helpers.createCardElement(cardConfig);
    } else {
      this.card.setConfig(cardConfig);
    }
    this.card.hass = this.hass;
    const hide = entities.length === 0 && this._config.show_empty === false;
    this.style.display = hide ? "none" : null;
    this.style.margin = hide ? "0" : null;
  }

  async update_entities() {
    const format = (entity) => {
      if (!entity) return null;
      return typeof entity === "string" ? { entity: entity.trim() } : entity;
    };
    let entities = [...(this._config?.entities?.map(format) || [])];

    if (!this.hass || !this._config.filter) {
      return entities;
    }

    if (this._template) {
      entities = entities.concat(this._template.map(format));
    }
    entities = entities.filter(Boolean);

    if (this._config.filter.include) {
      const all_entities = Object.keys(this.hass.states).map(format);
      for (const filter of this._config.filter.include) {
        if (filter.type) {
          entities.push(filter);
          continue;
        }

        let add = [];
        for (const entity of all_entities) {
          if (await filter_entity(this.hass, filter, entity.entity))
            add.push(
              JSON.parse(
                JSON.stringify({ ...entity, ...filter.options }).replace(
                  /this.entity_id/g,
                  entity.entity
                )
              )
            );
        }

        if (filter.sort) add = add.sort(get_sorter(this.hass, filter.sort));
        entities = entities.concat(add);
      }
    }

    // TODO: Add tests for exclusions
    if (this._config.filter.exclude) {
      for (const filter of this._config.filter.exclude) {
        const newEntities = [];
        for (const entity of entities) {
          if (
            entity.entity === undefined ||
            !(await filter_entity(this.hass, filter, entity.entity))
          )
            newEntities.push(entity);
        }
        entities = newEntities;
      }
    }

    if (this._config.sort) {
      // TODO: Add tests for sorting methods
      entities = entities.sort(get_sorter(this.hass, this._config.sort));
      if (this._config.sort.count) {
        // TODO: Add tests for pagination
        const start = this._config.sort.first ?? 0;
        entities = entities.slice(start, start + this._config.sort.count);
      }
    }

    if (this._config.unique) {
      let newEntities = [];
      for (const e of entities) {
        if (
          this._config.unique === "entity" &&
          newEntities.some((i) => i.entity === e.entity)
        )
          continue;
        if (newEntities.some((i) => compare_deep(i, e))) continue;
        newEntities.push(e);
      }
      entities = newEntities;
    }

    return entities;
  }

  async updated(changedProperties) {
    if (
      changedProperties.has("_template") ||
      (changedProperties.has("hass") && this.hass)
    ) {
      if (this.card) this.card.hass = this.hass;
      const entities = await this.update_entities();
      this.update_card(entities);
    }
  }

  createRenderRoot() {
    return this;
  }
  render() {
    return html`${this.card}`;
  }

  getCardSize() {
    let len = 0;
    if (this.card && this.card.getCardSize) len = this.card.getCardSize();
    if (len === 1 && this._entities?.length) len = this._entities.length;
    if (len === 0 && this._config.filter && this._config.filter.include)
      len = Object.keys(this._config.filter.include).length;
    return len || 1;
  }
}

if (!customElements.get("auto-entities")) {
  customElements.define("auto-entities", AutoEntities);
  console.info(
    `%cAUTO-ENTITIES ${pjson.version} IS INSTALLED`,
    "color: green; font-weight: bold",
    ""
  );
}