import type { AgentDriver, AgentName } from '../types.js';

export class DriverRegistry {
  private readonly drivers: Map<AgentName, AgentDriver>;

  constructor(drivers: AgentDriver[]) {
    this.drivers = new Map(drivers.map((driver) => [driver.name, driver]));
  }

  get(name: AgentName): AgentDriver {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new Error(`Unknown driver: ${name}`);
    }
    return driver;
  }

  values(): AgentDriver[] {
    return [...this.drivers.values()];
  }
}
