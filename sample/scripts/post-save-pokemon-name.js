// Post-request script: saves the queried Pokémon's name into the @lastPokemonName variable.
// Because @lastPokemonName is declared in the .http file, the new value is written back
// automatically — the next request that references {{lastPokemonName}} will see it.
const data = response.json();
if (data && data.name) {
  variables.lastPokemonName = data.name;
  console.log('Saved Pokémon name:', data.name);
}
