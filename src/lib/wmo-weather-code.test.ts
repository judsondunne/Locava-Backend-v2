import { describe, expect, it } from "vitest";
import { wmoCodeToOpenWeatherMain } from "./wmo-weather-code.js";

describe("wmoCodeToOpenWeatherMain", () => {
  it("maps common codes to OpenWeather-style mains", () => {
    expect(wmoCodeToOpenWeatherMain(0)).toBe("Clear");
    expect(wmoCodeToOpenWeatherMain(1)).toBe("Few Clouds");
    expect(wmoCodeToOpenWeatherMain(2)).toBe("Few Clouds");
    expect(wmoCodeToOpenWeatherMain(3)).toBe("Clouds");
    expect(wmoCodeToOpenWeatherMain(61)).toBe("Rain");
    expect(wmoCodeToOpenWeatherMain(71)).toBe("Snow");
    expect(wmoCodeToOpenWeatherMain(95)).toBe("Rain");
  });

  it("defaults unknown codes to Clouds", () => {
    expect(wmoCodeToOpenWeatherMain(9999)).toBe("Clouds");
  });
});
