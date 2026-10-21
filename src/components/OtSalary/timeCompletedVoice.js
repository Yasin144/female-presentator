// Embedded 8000 Hz 8-bit unsigned mono PCM voice clip: "Your time has completed."
// Guarantees 100% offline spoken voice inside Android WebView even if Android TTS or window.speechSynthesis is unavailable.
const TIME_COMPLETED_PCM_8K_B64 = 'g4ODg4OCgoKCgYGBgICAgH9/f39/f4B/gICAgICAgICAgYKBg4KEhIWFhoaGhoaFhYSEg4KBgIB/fn59fX19fX1+fn5+f39/f39/gYGChYSHiImKi4yLjIqJiYeFhIKAf318fHp6enp6e3t7fHx9fX1+fn5/gYGFhoeLjI2Pj5CPj42MioeFgoB9fHp5eHh3eHd4eXl7e3x8fH1+fX6BgYOIiIuQj5OTlJOTkY6MioSDf3x6d3Z1dHV0dnZ4eXp7fH1+fn9/foCEgoiMi5KVlJmYl5eVko2Lhn9/eHV0cHBwcHJydnd5fHx/f4CAgIF/gYiCipCMlpmXnpycmpiUjYqEfHp1b25tamxtbnF0d3l9foCCgoKCgoKCiYaLlJGXoZuho56dmpOOh4J5c3BpZmdlZmlsb3R4e36Bg4SFhYWEhISNio2bmJqpoqOqop2ckoqDe3NsZ2RhYmNlaW5zd3yBgoWIh4eHhYWEg4+MjaCenK6qo6ynmZmQgXx0aWVhXl9eY2lscnp9gYiIiouLiYiGhoKJkYuVpJ2hsKeiqZ2Rj4N3cWdiXllbX19lb3N4g4aIjpCOj46LioiDiZKNk6Oenqysn56hkIiFeGxmX15eXGRpanV+f4WOjY6Sj4yMiIaEgIWSjZGiopunp5mWlYZ8d25nZWFiZ2hsdnt9houKjI6MiomFg4J+fX+KkpObp6WipaGWjoV8c2tlZWVkaXF1eoGGioyMjIyIhYOCfn18fHyKlpieqKmmo5yTi350cGpjZGhqbnV5f4SHiIuKiIeFg4GAf35/foOUnJyiqKSfmpCGgHVtbGpoa3BzeH6Bg4aIhoaGhIKCgX+AgH9/gYycoZ+kpaCYkYZ+d3FrbG1ucXd6foKGhYaHhYODgoCAgIB/gYGAjZ6in6KknJSNg3l1cWtscHF0en5/goWCgIKBfn6AgH+Cg4KChIKNn6WfoKObkIqCd3JxbW1ydnZ7gYKBhISCgIB/fX6Af4CBgoGBhpikpJ+in5aLhXt0cXBucHV4enyBgoKChIKBgYCBgoKCgoOCgYCMnqSfnaCbkId/d3RzcG90eXt8gYOCgoOBgIGBf4CCgoGBg4KAhJakpJ2fn5eLgnp1c3NvcXh9fH6Bg4GBgYB/gYB/gIKCgoKDgoGNoaignKGekIN8d3JxcG90fH58foOCfn5/fn6AgYCChYSCg4aDhJiqppufpZqGfnt1bm5ucHd9fHqAg397foB+fYCCg4WGhYOFhICLoqiamaakjoCCfnBqbnBxdXl6foKAfH6Cf3t/hIOBhIeFhISDhZinoZmlrJuHh4d4aWxxbmxyeHp9fn6Ag4B9f4SCgIKIhoKEh4OMoKSYmKSdiH+EfGxpcXFtcHl7fX6BgYOCgIGEg4CDhoSBg4aDf4ygnZSaqp+Kh4+Dbm53c2htd3h1d3+Bf36Bg4OBgIWGg4GHh4OAj6Kakp2tnYmNk4JtcXhvZGp0c290fH59fIKFhICDiIeCg4mIgoKKmJiRl6WikI6Xj3t2f3lqaXN0a2x3end3f4OAf4OHhYKEh4eDg4aOlZGSm6GZkJeYi4CBg3dtcXRuZ210cW90e3t5foODgYOHhoSFhoaJjo2NkpaTkJSVjomLioJ+f314dXd3dHR3eHd4e3x8fX+AgIGCgoKEhYWGiImIiImKiYiIh4WFhIKBgYB/fn5+fX19fX1+fn5+f39/gICBgYGCg4ODhISEhISEhISDg4KCgYGAgH9/f39+fn5+f39/f3+AgICAgYGBgoKCgoODg4OCgoKCgoGBgYCAgIB/f39/f39/f39/gICAgICAgIGBgYGBgYGCgoKCgoGBgYGBgYCAgICAgICAgICAgICAgICAgICAgICAgIGBgYGBgYGBgYGBgYGBgYCAgICAgICAgICAgICAgICAgICAgICAgICAgYGBgYGBgYGBgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYGBgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgICBgYCBgYCAgICAgICAgX+AgICAf4KBf4GAgX+BgH+BfoGAf4J+gn9+gH6Bf4B/f4CBgIGCgYGAfoF/gIGAg36Cf4F/f39+fYB/fX18gX6DfIR/hH2CgoCBfn9+f3yAf39+gn9+gYCBg32HfIF+gISAf4Z7inmHgYCCe4d6gH16gHx/f4N+gX+DfYF+gYCCfoZ6hn6AgX9+gYJ+hn2IfoKDf4GBf4J8gIB6gnqEeIF8gX6CfoR+g4J7hnmGe4l6hXuEfX6HeIl8goB8hHx/hHqJeYSDdoh5gIN2jnSEgnyFeoZ+fISAfIh4i3eFgXuGfYGCfYN+gId7hICDf4CHf32HeIR5hYJ7iHuHe4GAeYl6hH+Ag3yCgnqEf36HdYx4gYV2ineDg3iJeYKDe4d9gYR8hX2AgnuFfIF/g4J9hH1+gnqHeISCfYN9fYF8hX6CgYCBeoR8hIB+hnuCf3uFeoSAfYZ6g4B9hX6DgXyBf3+AgYKBgIN+gnuDfn6FfYZ8gYJ7hH2ChHqHfoGAeYl+foN8iHd9gn+CfoWDfoJ9gX2BhH+BgoGBe4F/gYGBgYKAgICAf4CAgIGBfn+AgIB9hoGAgX6GfX2EfoN/fYd6gH+Bg3+Dgn9/gIKBfoWCgoB/gIB9gYGDfn6AgH98hIOAgX6Gf3yDf4SBfYR9fn9/hICCg39/e4GBf4KAg4J/goB+g36Dg3+Df4GDeYF+gYF8g4B9gHyCf36Bh4uEg4SGhIGEiYaFgoKCf4CAgYF+fn97fHt8fnx+fH18fH2GjoqLiYuLhIeKjIuKiomFgoGCgX9/gH58enh6d3h6eXt5eYOLi4uJjY2IiIuNjouNjYqHhISDgYCAgH57e3p5d3d4eHh3gY2Ki4iLjYaGiYuOiouMioeDgoSBgYB/gXt7e3l6eHd7eHmCkJKQjY+RjImLjpOPjo6MioOBgoCAfX1+enl1d3Z1dXZ3d4CTlpaRkJWQjY2QlpSSkJCOiYOCgYF+fHt7eHZzc3Ryc3RzgJWbnZOSlZOPjpCZmJWTjo2GgH9+gH17eHh1cnBvcXJzdXWAnKeonJKWl5WTk5qgmpWMhoN7eXh5end0cW1raGptcnN3d3mUrbOrl5SanZuWmaGgmYyCf3h1dHN3dHBsaWdnZmtxdXp5eYWourajkpign5iVnKOdkIJ8enRzcXV2cW1pZ2lna3B1e3p8fpm8u6+XkJ6fmpWUoqCThnh5dnJyc3d2cGtqaWxrcXd7fn17h6+9u6uXnqCblZCaoZmOf3h3cG9wc3hzb2xqbGtudHp/f35/nL++r5OOnJ+bkJKenZKAdXd1dXN1eXhybmtub3B2e3+Af3uItMS6noiUnJuNipWgmYV4cXd0cnV3fXhyb29xcnR7gIGBfn2gw8GuiYqanZKGiZ6cjnpudnR1c3V9fHVzb3Nyc3t+hIGBfYu7xrqYf5WcmoeAlZ6ZgW9yd3V1b3x6eXZtdXF1eHyBhH6DfIy+xL2VgpebloJ9l6GWf2t2eXdxbXyAfnVubHFxeXt+hH+Fe4m8wbqUhJyclH99mqCUfHB6fHVub32De3ZveXV3d3qEgoOBfo69wrSQiZycjXuEm6CMe3N+enBtc3+Cd3ZzeHhxenuEg4GCf42+v7CSiqCbiHyFnp2IfHaCdm9tdoJ8eHZ2enJ0eH2Ef4GCgI29vrCSjqKYh3uLn5qGfH5/dmlxd4F6dnh4eHFyen2BfoKFf428vq+QjaCVhHyLoZaGfX6Bb2txen54dnx4dXJxfnt/gIKHforBua+OkaWXgoCSpZWBhIKAbmh4enx0eXx5bnB2e3t7gYaCfYvAvKSSlKmTfoKToo2DiYZ9am94eHV1fn10cHJ4d3Z9g4WCe5HBtqGTnKeOfImWnoiEjIN4a298cnN4fH1ucnZ2dXWAhYGBga3Do5uZpZx9hpiWk4SOjXNxb3Z3a3d+eHNvdXVudX2CgICDlbywnqOhoIuDlpSRjo2TenN1cXJpdX13c3R0c2pzeXt+gIeHp7ulpaGml4SPlpGNj5SHeHV2cGpveXd1cnl0bm92enx9iYSSu6yopqeiiYuWj42NlI98eXlwa2l1dnJ1eXZzbXd2dn2ChJO7sqqwrp6OiJiMiZWTkn98fWtobG91cHd9dHNyc3Zze4V/lbiwqayqm4SIkYeHkJWOfn97bGhrdHJyfH55dHh3c3V9goKnt6iwr6eVhJSLhI+UlImBhXRpbW1xb3Z/eXZ6dXZyd4B6j7OqrLSvoouPk4KHkJGOg4aCbGxva25teX10eXx1dnN7f3ygsaWyt6qdjJOOf4uTjIyDhHxpbm1qcHF5f3Z8e3Z2dXl/kqeorLStopWQj4iGj4+OiYaAdm1samlscXZ2d3x6eXl5fY2coKetraiel5aPjIyOjouHhH52cW1sa2tsb3Fyc3R0dHWCjpWZn6OloZyamJaTkZKRjouIhYJ9eXd2dHRzc3Rzc3R0fomNkpaZnp6amZeWk4+LioeFgn99fXt6eXh4eHh4eXp6foWMkZSYnJ+fnZyamZaSjoqHhYF+e3p5eHd2d3h5eXp7fYOKj5SXm6Cjo6GgnpyYk46KhoN/e3l3dnV0dXZ3eHl7fYCIjpOXm5+jpKSioZ6blpGMh4N+end0c3JxcnN1d3h6fH+FjJKWmp6ipKSjoZ6bl5GMh4N/end0c3JxcXJzdXd4enyAh42SlpqeoqOioaCdmpWQi4eCfnp3dHNycXFzdHZ3eXt9g4qQlJiboKKjoaCem5eSjYmEgHt4dXRycnFyc3V2eHp8gIaMkZWZnaKjo6KhnpyXko2JhIB8eHZ0cnFxcnJ0dXd5e4GHjZGVmp6ioqKioZ+blpKOiYSAe3h1c3FwcHFxcnR2d3uBh4yRlpqfoaKjoqGfm5eTj4qFgX16d3VzcnJyc3R1d3l+g4iNkZabnqChoqKgnpqXk4+LhoJ/e3l2dHNycnNzdHV3fIGGio6TmJudnp+fn5yal5SQjYiFgX57eXd2dXR0dXV2eHyBhoqPlJibnp+goaCenJqXk4+MiIWBfnt5d3Z1dXV2d3h7gIWJjZGVmZudnp+fnp2cmpiVko+NioeFgoB+fXx7enl5en6BhIaIio2Njo+QkZCPj46Ni4uKiIeGhIOCgYB/fn19fHt8gIKEhYaIiIeIiImIiIiIh4aGhoWEhIODgoGBgIB/f35+fX6DhISFhoeGhYaGhoWGh4aFhYWEg4OCgoKBgYGAgH9/fn5+fYGDg4WEhoWDhISFhISGhYWFhISDg4OCgoGCgYGAf39+fn59f4ODg4OEhIKCg4ODhIWFhISEg4OCg4OCgoKCgYGBgICAf39/f4WDhIWEhYKChYOEhIWGg4SEgoKCg4KBgoGBgICAfn9/f39+f4WDg4WEhIGDhIKEhYWFg4WDgoKCg4GCgoKBgIF/f39/f35+foKFgoWFhYSChYSEhYaGhYWFg4ODg4KCg4KBgYCAfn5/fX5+fX+Eg4OEhYSBg4SDhYWHhYSGg4ODg4OCg4SBgYGAf36Af35+f31+h4OEh4WGgYSGgoSFh4SDh4KCgoKDf4OCgIB/gH1+f319fX59foiDhYiHhoOGh4OHiYmIhomFg4WEhIKFhIGBgX99fn59fX1+fHqEhIGGhoeBg4eBhYaJh4SKhIODg4SAhISBgoCCfH1/fX19fn56f4mBhoiIhoKIh4KJiYqHh4qEg4aEhIOEhn+DgX9/fIB8e398fHqEiYGJioiFg4qEhIqKioaKiYKFhISDg4aDgoKBf31+fnx9fn57fYuFh4yLi4SIi4SJiouKh42GhISEg4CDhIGBgYF+fH58e3t9fHqFjIiNj5CMiI6KiYuOjouMjYiFhISBf4GBfn1/fXp6enp3enp7d4SPjZaZm5eRlpGOkJGUjpKRi4mDg4R7fn17e3h7dHZ0dHVyeHh1hZGWm6GlnpialpKRlZeTk5ONhoF/enV3d3d1dXZycXFzcnR4enmGm5yjqqynnJyakpKUmJWQkouDfHh4cXJ1dHVzdXRvcXBwc3N6eYafoaivrauamZiPkJCWlIuNhn53cnRwb3V1d3R1d3F0dHZ7e4GCjqamrbKwrJuYlY2KjI6NhoSBd3Jvb29udHd3d3h5eHZ6fH6AhIiIoK2ts7KypJSVjIeEhYyEgIF5dW1tcW1ydnl8eH19enx7gYGBh4WSqamxs7KumZWQhYR/hYd9gX13dGtxb251dnx9eoF9fX59g4CDh4OSo6etrrGsmpaPiIN9g4N9f3t7dW5zcG9zdHx7e4F/gH9+hICDhYOSpKqytbm1o56XjYV+g4F7fHp6c21xbW1ucHd3eX5/gX+BhIKDhYSSo6mxtby6rKegmI6FhoJ8enh5c25wbm1qbHFxc3Z6fXx/goSDhYaJmqKqs7jAu7a0rKaak5GHgn16eXJwb21saGtramxtcnN0eXp8f3+Ch5OcpK2zube3t7KspJ+akYuGhIB6eHd1cm9vbmtqamtram1ucHJze4SJj5afpKWoqquopKShnJmWlJCMi4iGgn9/e3l2dXRycXFwcW9xcXV7fYGFiY2OkZKTk5OTlJKTkpGRj4+NjIqJiIaEhIKAf359fHt6enh8fX1/gIGBgIGCgoODhYWFhoaHhYeHh4aHiYeHiImIiIqKioiJiIeHhYeFhYSDgoGAgX6AfX19e3x5e3p5eXl5enh6eXh6eXt7ent7fHt8fn5/f4CBgIKDhIODhYaEhYWHhISEhYSChIODgYGCgICAgH9/f35/fX5+fn1+fn9+fn9/gH+CgYGAgYOBgYKEgYKCg4KAgYOBgICBgX6AgH9/fYB/fX5/f399gH6Af3+BgICBgIKAgoKCgYKCgoCCgIKAgICBf39/gH9+gIB/gH6Cf4CBgIF/gYCAgICBgX+Cf4CAf4F+gX+Af3+AgH+Af3+Af4GAgYCBgIGAgYCBgICCf4CAgIB/gIB/gIB/gH6Af4J+gICAgH+AgYCBf4F/gX+BgYB/gYCBfoGBgH9/gn9/foGBfoCBgYF/gYCBgICAgYCBgIJ/gX+Cf4CBgICAf4GBgICAgoB/gYGAf4CBgH+Af4F/gH5/gICAf4CBgH6AgYB9foKAgH2CgYB9f4OBfn6BgX99gIKAfYCDgH5/goF/f4CDf4B/hH9/gIGAf36Ag3+AgISCfoCDgX9/gYJ+f3+AgIB9foCCf36AgoF+foKCf3+BgoGAgX+BgIF/gICBf36AgIB/f4KBgIGBgYGAgYGAgH+DhIGAgoSDgH+Cg4GAgIGAgIGAgICBgYB/f4GAfn6AgoB+gIGAf36AgH9/gICAf3+AgYCAgICBgYGBgYGCgYGBgYGBgYGBgYCAgYGAgICBgIB/gICAf39/gH9/f39/fn9/f39/f4B/f4CAgICAgIGBgIGBgYGBgYGBgYGBgYGBgICAgICAgICAgICAgH+AgICAgICAgICAgICAgICAgICAgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH99gISAfICDgX2Bg39+gIOAfYGBf35/gX+AgIB/f4CBgICBgYB/gISEfn2DhYF+g4V9eoKHfHh+gn18goSBfICDgX1+gYKDgIGCfoF/fIKDf317e4CAgYJ9fH+Bf4ODg4GAg4B+g4WCeXyIgnl9hYJ1eIOFe3+Lg3x+hIN8god/fYCBfX6EgXqCg359hop8eomKeoCNg3Z9gnx3g4V+gYmCfXyChn98gYN/fICDfH6Cf4J9goJ+gn1+gH+AfoCBfoGDgIOEgoF/gYF/gIJ9gYJ9gH99g4KBhISGgYCGgH2AgH97foB5foJ+en6DgH6ChYGCgYOBf4KCgH9+g4F9gYGBfXyAgH1+g4GBg4KCgIOCf4CDgX+Bg35+goJ+foJ/e4CAf35+gH59gIF/gYGBgoCBgoGCfoGEf36BgoB7foN/e3+Cf3x/g4B/gIOCfoGBf4KBgYKChIF/hYF/gYKCgH2BgHx/gH18f398fYB/fn6AhYSBhIaEgoKFhIGCg4OBgIB/fn5+fn1+fX19fn5+fn9/gH+AgICBgYGDiImIiYuLiIeIh4SFhYSDgoKBfn5+fXt7fHt6e3t7e3t8fHx9fn5/f3+FjZCSlZaXlJKRj4yLioqIhoaEgX99e3p3d3d2dXV1dnZ2dnh4eXp8fX6Kk5ibnZ+hnJmXlZOQj5CNi4mGhIB8enh2dHBwcG9vb29xcXJzdHZ3eH+MlZueoKSkoZ6bmpiVlJOSkI2KiISAfXp4dnRzcnJxcXFxcnJzdHV2d4CKkpeZm5+fn52amZiVlZORkI2LioaEgn99e3l4dnV1dXV1dXZ3eHl6fISKj5OWmZ2foJ+dm5uYlpKPjImHg4B+fXt6enl4eHh5eXl6e3t8fX1+goeMkJSXm5+hoqKgn52alpKNioaDgH16eXh4d3d4eXp7fH1+f4CBgYGChouPk5aZnaCioqKgn52ZlZGMiISAfHh1dHJycXFydHV3eHp8foCBgoOEiI+Tl5qdoqWmpqWioZ6alI+KhoJ+end0c3JycXNzdnd5enx+gIGCg4SEipGWmZ2gpqmqqaeko5+ZkoyGgn14c3Fubm1ubnBydXd6fH+BhISGhoeHjpWanaGjqKysqqikop2YkIqEgHt2cm9tbW1ubnBydXh6fH+Bg4WFhoeGiZCWmp2gpKmrqqekoZ6ZkouEf3t3cm9sbGxtbm9xdHd5fH6AgoSEhYWFhYuRlpmdn6WoqqmnpKOfmpSOiIR/e3ZzcG9vb29wcXN1d3l7fX+AgYKCg4OHjpKXm56kqausq6qopqGclpCLhYB7d3Nxb25ubm5wcnR1d3l7fH5/f4CBhYqPlJicoqeqrKyrq6iloJuVj4qEf3p2c3Fvbm5ub3Byc3V2eHp7fH19foCFiY2QlJidoKKkpKSjoZ6alpGNiISAfHl2dHNycnJzdHV2d3h5ent7fHx9gIOHio2RlZmcnp+goJ+em5iVkY2JhYF+e3l3dXR0dHR1dXZ3eHl5enp6e31/goWIi4+SlZiam5ydnJuZl5SRjoqHhIF+fHp4d3Z2dnZ3d3h4eXp6e3t8fX+BhIaIi46Rk5WWl5iYl5eVk5GPjYqHhYOBf318e3p6enp6enp7fHx9fX6AgoOFh4mMjY+QkZKSkpKSkY+OjYuJh4SDgX9+fXx7enp6enp7e3x9fX5/gIKEhoeJioyNjY6Ojo6NjYyLiYiHhYSDgYB/fn19fHx8fHx9fX5/f4CBgoKDhIWGh4eIiImJiYiIh4eGhYSDgoGAgH9+fX19fHx8fHx9fX1+fn9/gICBgYKCg4OEhISFhYWFhYWEhIODgoKBgYCAf39/fn5+fn5+fn5/f39/gICAgIGBgYGBgoKCgoKCgoKCgoKCgoKCgoGBgYGBgYGBgYGAgICAgICAgICAgICAgICAgICBgYGBgYGBgYGBgYGAgICAgICAgICAf39/f39/gICAgICAgICAgICBgYGBgYGBgYGBgYGBgICAgICAgICAgICAgICAgICAgICBgYGBgYGBgICAgICAgICAf39/f39/f39/f39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBgYCBgIGAgICAgYCAgICAgH+Af4CAf4B/fn+AgH+AgICAf4CAgYGBgoGBf3+BgIGAgIGBgYGBgIF/gYCBgYGBgX6AfoF/gH+Af4B+gH+BgIB/gH6DfoF/gIF+f39/gX6Af3+AgICBgIKAf3+BgIF/gYCCgYKAgH9/gIGCgIGAg4GBgYGAgIGCf4B9gH+Bf4F/gH+AgH9/f4GBgIJ/gYGAf3+AgoCAgIGBfoGAgIB+gH+BgICAgYGBgYGAgH+BgICAgYCBgYCCgIB/f4F/gICBf4KAgX5+goKBf3+AgYCBf4CAf4J/gIB/gX5/f4CAgIGAgYCAgIGCf3+BgYCAf4F/f36BgICBf4KAgYCAgYGBgIGBgYGAgICAf4KBgYGBgIB/gICAgYCBfoCBgICAf4CCgYKAgoGAgYGAgICAf3+Af39/gH9/gIF/gIGAf3+AgYGBgICBf4KBgoF/gICAgIGBgYCBgH9/gIGBf4CAgX9/gX+Af3+AgYCAgIGBgYCCgIB/gIF/gICBf4GAgH9+goKAgH9/gYCAgICBgX+AgIKBgYGAgICCgH9+f4CAgH+Af4CAgIB/f4CBgICAf4CAgYB/gH+AgIGAgICAgH+AgYCAgICAgYCBf3+BgIGBgICAgICAgICAgICAgIODgYCAgoKBgICAgIGAgH9/gH9/f39/f4B/gICAgICAgICAgIGAgYCDhYSEg4WFhISDg4OCgoGBgICAf39+fn5+fn5+fn5/f39/gICAgICAg4iKjIyNjo6Ni4mHhYSCgX9+fX18e3t7e3t7e3t8fH19fX5/f4CAgYWMkpaXmJqbmpaRjYiFgX16d3Z2dXV1dnd3eHl6e3x9fn+BgoODhISJkpidnqGkpKKclZCKhH13c3BvbW1ucHJ0dnh6fH5/gYKDhYWGhoeGi5WboKGkqailnZeSiYF4cW5qaGZnam1wc3Z7fYCBgoWFhYaFhoaGhYyYnKKkqrCsqKGalId9dGxoYWBfYWZob3N4foCEhoeKiIqKiIqIiYiOnJ2jqayzqqajl49/dW5hXVhYXFxkanF6fYaJi42LjYqGh4ODgoKDi5qco62ytK+sp5iMf3NnXFdVU1ZdZG10f4WLj5CSj4uLhoOCgIGAgI6amqeytLaysKaUjH1uYVhUTk9VXGRoc3+FjJOUlJCNhoGAe3h7e32MmZurt7i7urapm5B9a2BVTUdMT1VgbXiBjJOWlpeSiomAenl0eHd6jpaZs7i5xcC7sKKXfW9kTktFQ0hNW2Zug4iPm5ial5GNg4J7d3p3e4mUl662tcXAt7akl4VzZlJLRz5GS1Fia3qGjJuYm56Tk42Cgnp5e3eJkI+uqrDEtbe0oJeHdWdYUEZFSUtWYWt7go6Vl52XlZKIhoF5e3l4gY+NoK6nubqutKeVkH1tZFdQTk1QV2BodX6GkJGUlo+PioKDe3l8eXyMjZSqpa29qrOumJuGd3JeXFNRVVNgZGx7e4iMjJKNjYiDgnt8eHl9e42OlKuir7qqtaucm4l8dWVhWFhWWGBibXR6g4SLi4qNhoaDfX98e39+ipCQqKCsuKi1q6CejIR3bGVaWlZWXV5nb3R+goiLjI2JioaCgnx+fnqFi4udoKOzrrCyp6KajIJ2a2BdVVRXV2BmbXZ9g4qNj5GNjoqFhn9/fnuCi4eanp6yqq21o6aci4h3bGVaV1VTWVtjbHF9goiPj5GSjoyJhIN/fX97iImLopios6W3rKOnkYyBcGteWVVRVlZfZWx5fIiLj5WQk5GKi4SBgXt/fIeJjqCaqa+os6mjnpCHem9iXFZQVFNYYmZ0eoOMjpeUlZWOjoeCgXp8e3mCh4mYnKCsrKqupZ6ZiYB1aWBZVVJTV1pkanN8goqNkpKSkoyKh4CBfHt+e4KLiJidnqupqa2koZmOh3lzaWFfWlpdXmRqcHh8g4aJjYqMiYaFf398ent6fIOGi5aYn6enq6uppp+bkomDeXNtZ2ViYmRlaW1xdnl+gYOFhYWEg4J/fn18e36Bg4mPlJuhpquusLCvrKeim5SMhH13cWxoZmRkZWZpbG1wdHd5fH1/gIB/f35/fn+AgYOFiIqMj5GTlZWWlpWUkpCNioiEgn98enh2dXV0dHV1dnd4eXp7fH1+f4GCg4WGiImKi4yNjY2NjYyLiomHhoWDgoB/fn19fHt7e3t7e3x7fHx9fX5+fn9/g4OEh4iJiouMi4uLiYmIhoWEg4KBgH9+fn19fHx8fHx8fX1+fX9+f4B/gIGAgYGAhIaFiYqKi4uMiYmIhoSDgn9/fn18fHt7e3x8fH19fX5+f3+AgICBgYGCgYKBgoKBgYSHhomNjY6QkY6OjomHhYJ/fHx5eHh3eHh6enp8fX1+f3+AgIGAgIKBgoKCgoKCgoCBh4yJlJmWnJybl5OSiIOCeXZycXFtc3NyeXh9fX+EgIOEgoOBg4F/g4CAgoCCgYGDgIGAh5GLmJ+aoKCemJCRhH58dnJva3FscHZ4fn2GgoWJg4eFg4V/g4B+g36AgH+BfoCBfoJ+gJGNk6GgoaKinJGRiHx6dHFsb3Fwc3p5fYCChIKGhIOEg4KBgoGAgYGAgICAf39/f35/gH6IlI6dpKCin56Riol7dnRwcGx0dHN7e35+goSAg4SCgoODg4GEgYGCgIB/f4B+fn9+f3+Af4GTkJWjoqGfnpiJioF4dXRzcHJ4dXh9fX9/gYOAgoWBg4OCg4CDgX+Bf39/foB+f4B/gICAgH+JlY+do6GfnJuNh4V8dnV0dXJ3end8fX9+f4OAgYSCg4GEgn+DgIF/f4F9f4F9gX+AgX6BgIB/iJWPm6SenpmYjoKGfXd5d3p2eX94fX59fnyCgH6EgoGDgoR/g4WAhISDg4GDgX6Cf36AfoF9gIB/kZCToJ6emZaVhYWCenp4e3p3fnx6fX1/fX2CfoGCgYSAhIJ/g3+BgH+CfoCBfoF/gIF9gYB+gn6CkY+Un5+emJiThYWBfHt5fnp5fnt6e3p8eXuAfICCgYOAhIKAg4CBgYCCf4GCgIF/gIB+gH9/gH+AgI+RkZ2dm5eSkoWBg3t7en1+eH5+eXt6fHp6gH5/goKDgYKEf4KBgYGAgoGAgoCAf3+Afn+Af4B/gX+Gko6XnpualJONgoSAfH18f3x6f3p5enl6eXt/fYCCgoOBgoOAgoGBgoGCgYGBgYKAgYKBgYGBgICAf4aPjpSbmpeSkouBgn98fHx/fHt+e3p5enp6fH5+gIGCgYGCgYGBgYKBgoKBgYGAgH9/gH+Af3+Af4CAf4yNj5eZmZSSkoeEg39+e35+en18e3p4fHl5fXx/f4CDgIKDgYOBgoN/g4KBg3+CgH6BfoB/foF9gIB+gYiLjZKXl5SUkoyIhoOAfX5+fHt8e3p6enp5e3x9fn+BgoGDg4ODgoSCgYOBgoGBgX+AgH9/fn9/foB/gIiJjJKUlpSUlI6LiYaDf4B+fHx7e3l5e3l6ent8e35/f4CBgoKBg4KDgoKDgYKCgYKBgYKAgIGAgH+AgISGiIyPkJCQkY6LioeFgoGAfn19fHt6e3t6e3t8fHx9fX1+f4B/gIGBgYGCgoGCgoGBgYGBgYGBgICAgISEhomKjIyNjoyMi4qIhoWEgYGAf359fn18fX19fH19fX1+fn9+f39/f4CAgICBgYGBgYGBgYGBgYCBgYGCgoODhISFhYWGhoWFhYWEhIODg4KCgYGAgICAf39/f39/f4CAgICAgICAgICAgYCBgYGBgICAgICAgICBgYGBgoKCgoODg4ODg4ODg4ODg4OCgoKCgYGBgYGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYGBgYGBgYGBgYGBgYGBgYGBgICAgICAf39/f39/f39/f39/f4CAgICAgICAgICAgICAgICAgIGAgICAgICAgICAgICAf4CAgICAgICAgICAgICAgICAgICAgICAf39/gIGAgX9+f3+AgX9/fn9/gICBgYCBgIGBgYKAgIGAgICAgX5/fn0=';

let cachedPcmBytes = null;
let cachedWavDataUri = null;
let sharedVoiceCtx = null;
let unlockListenersBound = false;
let pendingSpeakOnGesture = false;

function decodePcmBytes() {
  if (cachedPcmBytes) return cachedPcmBytes;
  try {
    const bin = typeof atob === 'function' ? atob(TIME_COMPLETED_PCM_8K_B64) : '';
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i) & 0xff;
    }
    cachedPcmBytes = bytes;
    return bytes;
  } catch (_) {
    return new Uint8Array(0);
  }
}

function buildWavDataUri() {
  if (cachedWavDataUri) return cachedWavDataUri;
  try {
    const pcm = decodePcmBytes();
    if (!pcm.length) return '';
    const pauseSamples = 3200; // 0.4s silence at 8000 Hz
    const totalDataLen = pcm.length * 2 + pauseSamples;
    const wav = new Uint8Array(44 + totalDataLen);
    const view = new DataView(wav.buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) wav[offset + i] = str.charCodeAt(i);
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + totalDataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
    view.setUint16(22, 1, true);  // NumChannels = 1
    view.setUint32(24, 8000, true); // SampleRate = 8000
    view.setUint32(28, 8000, true); // ByteRate = 8000
    view.setUint16(32, 1, true);  // BlockAlign = 1
    view.setUint16(34, 8, true);  // BitsPerSample = 8
    writeStr(36, 'data');
    view.setUint32(40, totalDataLen, true);
    wav.set(pcm, 44);
    wav.fill(128, 44 + pcm.length, 44 + pcm.length + pauseSamples);
    wav.set(pcm, 44 + pcm.length + pauseSamples);

    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < wav.length; i += chunk) {
      bin += String.fromCharCode.apply(null, wav.subarray(i, i + chunk));
    }
    cachedWavDataUri = 'data:audio/wav;base64,' + btoa(bin);
    return cachedWavDataUri;
  } catch (_) {
    return '';
  }
}

function getOrInitAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedVoiceCtx || sharedVoiceCtx.state === 'closed') {
    try {
      sharedVoiceCtx = new AudioCtx();
    } catch (_) {
      return null;
    }
  }
  return sharedVoiceCtx;
}

export function ensureVoiceAudioUnlocked() {
  if (typeof window === 'undefined' || unlockListenersBound) return;
  unlockListenersBound = true;
  const unlock = () => {
    try {
      const ctx = getOrInitAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (pendingSpeakOnGesture) {
        pendingSpeakOnGesture = false;
        speakTimeCompletedOutLoud();
      }
    } catch (_) {}
  };
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, unlock, { passive: true, capture: true });
  });
}

export function speakTimeCompletedOutLoud() {
  if (typeof window === 'undefined') return false;
  ensureVoiceAudioUnlocked();

  let playedWebAudio = false;
  try {
    const pcm = decodePcmBytes();
    const ctx = getOrInitAudioContext();
    if (ctx && pcm.length > 0) {
      const playBufferNow = () => {
        try {
          const sampleRate = 8000;
          const chimeSamples = Math.floor(sampleRate * 0.32);
          const pauseSamples = Math.floor(sampleRate * 0.42);
          const totalSamples = chimeSamples + pcm.length + pauseSamples + pcm.length;
          const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
          const channel = audioBuffer.getChannelData(0);

          // 1. Attention two-tone chime (880 Hz -> 1320 Hz)
          for (let i = 0; i < chimeSamples; i++) {
            const t = i / sampleRate;
            const freq = t < 0.14 ? 880 : 1320;
            const env = Math.exp(-t * 6.5);
            channel[i] = Math.sin(2 * Math.PI * freq * t) * 0.35 * env;
          }

          // 2. First announcement: "Your time has completed."
          let offset = chimeSamples;
          for (let i = 0; i < pcm.length; i++) {
            const norm = ((pcm[i] - 128) / 128) * 1.45;
            channel[offset + i] = Math.max(-1, Math.min(1, norm));
          }

          // 3. Second announcement after short pause: "Your time has completed."
          offset = chimeSamples + pcm.length + pauseSamples;
          for (let i = 0; i < pcm.length; i++) {
            const norm = ((pcm[i] - 128) / 128) * 1.45;
            channel[offset + i] = Math.max(-1, Math.min(1, norm));
          }

          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          const gain = ctx.createGain();
          gain.gain.value = 1.0;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start(0);
          return true;
        } catch (_) {
          return false;
        }
      };

      if (ctx.state === 'suspended') {
        pendingSpeakOnGesture = true;
        ctx.resume().then(() => {
          if (ctx.state === 'running') {
            pendingSpeakOnGesture = false;
            playBufferNow();
          }
        }).catch(() => {});
      } else {
        playedWebAudio = playBufferNow();
      }
    }
  } catch (_) {}

  // Also try HTML5 Audio WAV data URI fallback if WebAudio wasn't immediately running
  if (!playedWebAudio && typeof Audio !== 'undefined') {
    try {
      const uri = buildWavDataUri();
      if (uri) {
        const audio = new Audio(uri);
        audio.volume = 1.0;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            pendingSpeakOnGesture = true;
          });
        }
      }
    } catch (_) {}
  }

  // Also trigger W3C speechSynthesis if available
  try {
    if (typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function') {
      window.speechSynthesis.cancel();
      const utter = new window.SpeechSynthesisUtterance('Your time has completed');
      utter.rate = 0.95;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    }
  } catch (_) {}

  return true;
}