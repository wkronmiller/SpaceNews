# About

This program is the digital editor for the "Space News" Alexa Flash Brief.
It combines an RSS scraper/cleaner with an Elasticsearch client to find interesting news related to space.
I am currently in the process of re-factoring it to work more generally, so that other developers can create their own flash briefs with it.

# Configuration

Most (hopefully all) important configuration settings are in the `config.js` file.
Some settings can be overridden using environment variables, while others cannot.
The settings that are not overridable are ones you would in theory not have to change between different deployments (i.e. different news topics); they are also the settings that would be cumbersome to set as environment variables.
