# -*- coding: utf-8 -*-
"""
MelhorCasa - combinando scraper.py + Flet GUI

Alterações: atualizado scraping para vários sites (todos exceto Netimoveis)
de forma a refletir a lógica e seletores dos scripts individuais fornecidos.

Correções adicionadas:
- Netimoveis: agora aceita múltiplos tipos (ex: apartamento,casa) e inclui
  parâmetro 'tipo' na query string. O segmento de caminho usa o primeiro tipo
  como categoria (ex: /apartamento) enquanto o parâmetro tipo pode conter
  múltiplos valores separados por vírgula (ex: tipo=apartamento,casa).
- Loft: agora aceita o parâmetro 'tipo-de-imovel' (mantendo a sintaxe com "~"
  como separador ou convertendo vírgulas para "~") e inclui transacao=venda e
  precoMax na query string para filtrar por tipos/preço corretamente.

Correção de bug relatado:
- Algumas execuções do scraper encontravam imóveis (logs mostravam "Emitidos"),
  mas a interface acabava exibindo "0 imóveis encontrados". Causa principal:
  quando o scraping era disparado automaticamente na inicialização (_auto_start_scraping_on_open)
  a função run_scraping era chamada diretamente sem ajustar a flag self.scraping nem os
  controles da UI. Como o loop que popula self.properties verifica `if not self.scraping: break`,
  a execução terminava sem adicionar itens. Para resolver:
  - garantimos que run_scraping define self.scraping = True ao iniciar (se necessário)
    e atualiza os botões Start/Stop para refletir estado;
  - _auto_start_scraping_on_open agora dispara o scraping em thread, ajustando a UI/flags
    da mesma forma que on_start_scraping faz.
"""

import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import traceback
import os
import threading
import sys
from typing import Any, Callable, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

# Selenium + webdriver-manager
from selenium import webdriver
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from webdriver_manager.firefox import GeckoDriverManager

# Flet GUI
import flet as ft


# Email sending (used by GUI's auto-search)
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate

# Optional: openpyxl used only for export
try:
    import openpyxl  # type: ignore
except Exception:
    openpyxl = None  # handled when user tries to export

# ---------------------------
# Config / constants
# ---------------------------
MAX_PAGES_NETIMOVEIS = 60  # safety limit for pagination
DEFAULT_SCRAPER_TIMEOUT = 600  # seconds for a full run if needed

EMAIL_FROM = "oluanmendes@gmail.com"
EMAIL_APP_PASSWORD = "wyra wpyq frhf qcty"
EMAIL_TO = "oluanmendes@gmail.com"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465

# --- Adicione isto logo após os imports ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0"
]


# ---------------------------
# Utilities
# ---------------------------


import random

def human_delay(min_sec=2, max_sec=5):
    time.sleep(random.uniform(min_sec, max_sec))

def log(msg: str):
    import sys as _sys
    _sys.stderr.write(msg + "\n")
    _sys.stderr.flush()


def parse_int(s: str) -> int:
    try:
        return int("".join([c for c in str(s) if c.isdigit()]))
    except Exception:
        return 0


def sanitize_image(url: str) -> str:
    if not url:
        return ""
    if url.startswith("http:"):
        return url.replace("http:", "https:", 1)
    if url.startswith("//"):
        return "https:" + url
    return url


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(c for c in normalized if not unicodedata.combining(c))


def slugify(text: str) -> str:
    base = strip_accents(text.lower())
    base = re.sub(r"[^a-z0-9]+", "-", base)
    return base.strip("-") or "belo-horizonte"

def stealth_click(driver, element):
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", element)
    human_delay(0.5, 1)
    driver.execute_script("arguments[0].click();", element)


# ---------------------------
# Scraper helpers & core functions (adapted from seu scraper)
# Each scraping_* accepts emit(obj) and filtros dict
# ---------------------------

FiltrosType = dict


def build_firefox(headless: bool = True, extra_prefs: Optional[Dict[str, Any]] = None) -> webdriver.Firefox:
    options = Options()
    if headless:
        options.add_argument("--headless")
    
    # 1. Escolha um User-Agent aleatório da lista que criamos
    import random
    random_ua = random.choice(USER_AGENTS)
    options.set_preference("general.useragent.override", random_ua)

    # 2. Desativa a flag 'navigator.webdriver' (Essencial!)
    options.set_preference("dom.webdriver.enabled", False)
    options.set_preference("useAutomationExtension", False)
    
    # 3. Evita rastreio de automação adicional
    options.add_argument("--disable-blink-features=AutomationControlled")

    if extra_prefs:
        for k, v in extra_prefs.items():
            options.set_preference(k, v)

    service = FirefoxService(executable_path=GeckoDriverManager().install())
    driver = webdriver.Firefox(service=service, options=options)
    
    # 4. Limpeza final via JavaScript (Remove vestígios no navegador aberto)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    
    return driver
# ---------------------------
# Netimoveis scraper (modified to support multi-tipo)
# ---------------------------

def scraping_netimoveis(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    log("[Netimóveis] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 10)

    def categoria_from_tipo(tipo: str) -> Optional[str]:
        t = (tipo or "").strip().lower()
        if not t or t in {"indiferente", "todos", "all"}:
            return None
        if "casa" in t:
            return "casa"
        if "estacion" in t or "garag" in t:
            return "estacionamento"
        if "sala" in t:
            return "sala"
        if "loja" in t:
            return "loja"
        if "lote" in t or "terreno" in t:
            return "lote"
        return "apartamento"

    def pick_min_value(raw: str) -> str:
        if not raw:
            return ""
        parts = [p.strip() for p in str(raw).split(',') if p.strip()]
        nums = []
        for p in parts:
            digits = ''.join([c for c in p if c.isdigit()])
            if digits:
                try:
                    nums.append(int(digits))
                except Exception:
                    continue
        if not nums:
            return ""
        return str(min(nums))

    def montar_url():
        # Parse tipo_imovel: accept comma-separated or tilde-separated tokens,
        # map to Netimoveis types such as 'apartamento' and 'casa'
        tipo_raw = (filtros.get("tipo_imovel") or "").strip().lower()
        tipo_tokens = []
        if tipo_raw:
            for token in re.split(r'[,;\~]+', tipo_raw):
                t = token.strip()
                if not t:
                    continue
                if "apart" in t:
                    tipo_tokens.append("apartamento")
                elif "casa" in t:
                    tipo_tokens.append("casa")
                elif "loft" in t or "padrao" in t:
                    # treat generic as apartamento
                    tipo_tokens.append("apartamento")
                else:
                    # fallback: keep token (best-effort)
                    tipo_tokens.append(t)
        # choose a path segment: prefer first token if available, otherwise fall back to categoria
        categoria = categoria_from_tipo(filtros.get("tipo_imovel", "")) or categoria_from_tipo(filtros.get("tipo_imovel", ""))
        path_category = None
        if tipo_tokens:
            # use the first token as path segment (ex: /apartamento)
            path_category = tipo_tokens[0]
        elif categoria:
            path_category = categoria

        raw_city = str(filtros.get("endereco") or filtros.get("cidade") or "Belo Horizonte")
        parts = [p.strip() for p in re.split(r"[,]+", raw_city) if p.strip()]
        if len(parts) >= 2:
            bairro_slug = slugify(parts[0])
            city_slug = slugify(parts[1])
            base = f"https://www.netimoveis.com/venda/minas-gerais/{city_slug}/{bairro_slug}"
            localizacao_token = f"BR-MG-{city_slug}-{bairro_slug}-"
        else:
            city_slug = slugify(raw_city.replace("+", " "))
            base = f"https://www.netimoveis.com/venda/minas-gerais/{city_slug}"
            localizacao_token = f"BR-MG-{city_slug}---"

        if path_category:
            base = f"{base}/{path_category}"

        quartos_val = pick_min_value(filtros.get("quartos", ""))
        vagas_val = pick_min_value(filtros.get("vagas", ""))
        banhos_val = pick_min_value(filtros.get("banhos", ""))
        params: Dict[str, Any] = {
            "transacao": "venda",
            "localizacao": localizacao_token,
            "quartos": quartos_val,
            "valorMax": filtros.get("valorMax", ""),
            "areaMin": filtros.get("areaMin", ""),
            "vagas": vagas_val,
            "banhos": banhos_val,
            "pagina": "1",
        }
        # If multiple tipos were parsed, include them as the 'tipo' param (comma separated)
        if tipo_tokens:
            # unique and preserve order
            seen = []
            for t in tipo_tokens:
                if t not in seen:
                    seen.append(t)
            params["tipo"] = ",".join(seen)

        # build query (remove empty)
        query_items = {k: v for k, v in params.items() if v}
        return f"{base}?{urllib.parse.urlencode(query_items, doseq=True)}"

    url = montar_url()
    log(f"[Netimóveis] Acessando: {url}")
    try:
        driver.get(url)
    except Exception as e:
        log(f"[Netimóveis] Erro ao carregar página inicial: {e}")
        driver.quit()
        return
    time.sleep(1)

    page_counter = 1
    while True:
        try:
            cards = driver.find_elements(By.CSS_SELECTOR, "article.card-imovel")
            log(f"[Netimóveis] Encontrados {len(cards)} cards na página {page_counter}.")
            for card in cards:
                try:
                    img_el = None
                    try:
                        img_el = card.find_element(By.CSS_SELECTOR, "img.featured-image")
                    except Exception:
                        try:
                            img_el = card.find_element(By.CSS_SELECTOR, "img")
                        except Exception:
                            img_el = None
                    imagem = ""
                    if img_el is not None:
                        imagem = img_el.get_attribute("src") or ""
                        if (not imagem) or ("sem-foto" in imagem):
                            imagem = img_el.get_attribute("data-defer-src") or imagem
                    if (not imagem) or ("sem-foto" in imagem):
                        try:
                            alt_img = card.find_element(By.CSS_SELECTOR, ".swiper-wrapper img")
                            imagem = alt_img.get_attribute("data-defer-src") or alt_img.get_attribute("src") or imagem
                        except Exception:
                            pass
                    imagem = sanitize_image(imagem)

                    titulo = card.find_element(By.CSS_SELECTOR, ".tipo h2").text
                    m2 = card.find_element(By.CSS_SELECTOR, ".caracteristica.area").text
                    quartos = card.find_element(By.CSS_SELECTOR, ".caracteristica.quartos").text
                    garagem = card.find_element(By.CSS_SELECTOR, ".caracteristica.vagas").text
                    localizacao = card.find_element(By.CSS_SELECTOR, ".endereco").text
                    valor = card.find_element(By.CSS_SELECTOR, ".valor").text
                    link = card.find_element(By.CSS_SELECTOR, "a.link-imovel").get_attribute("href")
                    emit({
                        "site": "Netimoveis",
                        "nome": titulo,
                        "imagem": imagem,
                        "valor": valor,
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": quartos,
                        "garagem": garagem,
                    })
                except Exception as e:
                    log(f"[Netimóveis] Erro ao extrair card: {e}")
                    continue

            # pagination logic - robust
            if page_counter >= MAX_PAGES_NETIMOVEIS:
                log(f"[Netimóveis] Limite máximo de páginas ({MAX_PAGES_NETIMOVEIS}) atingido; encerrando.")
                break

            # capture fingerprint to detect changes after clicking next
            current_url = driver.current_url
            current_page_num = _get_page_from_url(current_url)
            try:
                first_card = driver.find_elements(By.CSS_SELECTOR, "article.card-imovel")[0]
            except Exception:
                first_card = None
            current_cards_count = len(driver.find_elements(By.CSS_SELECTOR, "article.card-imovel"))

            # try multiple selectors for next; ensure button not disabled
            next_selectors = [
                "li.clnext.page-item a.next",
                "a.next",
                "a[rel='next']",
                "li.next a",
                "a[aria-label*='Próxima' i]",
                "a[aria-label*='Proxima' i]"
            ]

            next_btn = None
            sel_used = None
            for sel in next_selectors:
                try:
                    candidate = driver.find_element(By.CSS_SELECTOR, sel)
                    # check disabled-ish attributes or classes
                    disabled = False
                    try:
                        att = candidate.get_attribute("aria-disabled")
                        if att and att.lower() in ("true", "1"):
                            disabled = True
                    except Exception:
                        pass
                    try:
                        cls = (candidate.get_attribute("class") or "").lower()
                        if "disabled" in cls or "disabled" in (candidate.get_attribute("aria-disabled") or ""):
                            disabled = True
                    except Exception:
                        pass
                    if disabled:
                        next_btn = None
                        continue
                    next_btn = candidate
                    sel_used = sel
                    break
                except Exception:
                    continue

            if not next_btn:
                log("[Netimóveis] Botão de próxima página não encontrado ou desabilitado; encerrando paginação.")
                break

            # click and wait for change: prefer staleness_of(first_card) or URL change or cards count change
            try:
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", next_btn)
                time.sleep(0.2)
                driver.execute_script("arguments[0].click();", next_btn)
            except Exception:
                try:
                    next_btn.click()
                except Exception:
                    log("[Netimóveis] Falha ao clicar botão next; encerrando paginação.")
                    break

            # wait up to N seconds for change
            changed = False
            wait_total = 8
            waited = 0.0
            poll = 0.5
            while waited < wait_total:
                time.sleep(poll)
                waited += poll
                new_url = driver.current_url
                new_page_num = _get_page_from_url(new_url)
                if new_url != current_url and new_page_num != current_page_num:
                    changed = True
                    break
                # staleness
                try:
                    if first_card:
                        WebDriverWait(driver, 1).until(EC.staleness_of(first_card))
                        changed = True
                        break
                except Exception:
                    pass
                # cards count change
                new_cards_count = len(driver.find_elements(By.CSS_SELECTOR, "article.card-imovel"))
                if new_cards_count != current_cards_count:
                    changed = True
                    break

            if not changed:
                # nothing changed -> likely last page or site blocked click; stop to avoid infinite loop
                log("[Netimóveis] Após clique não houve mudança detectada (URL/cards). Encerrando paginação.")
                break

            page_counter += 1
            time.sleep(1)
        except Exception as e:
            log(f"[Netimóveis] Erro genérico na paginação/extracao: {e}")
            break

    try:
        driver.quit()
    except Exception:
        pass
    log("[Netimóveis] Finalizado.")


# ---------------------------
# Updated scrapers to match per-site scripts (except Netimoveis)
# ---------------------------

def scraping_quintoandar(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Implementação baseada no script Quinto Andar.py:
    - procura por cards [data-testid="house-card-container"]
    - tenta clicar no botão 'see-more' (id=see-more) para carregar mais
    """
    log("[QuintoAndar] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 10)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "belo horizonte").lower().strip()
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]
        city_slug = f"{parts[0].replace(' ', '-')}-{parts[1].replace(' ', '-')}" if len(parts) >= 2 else raw_end.replace(' ', '-')
        url = f"https://www.quintoandar.com.br/comprar/imovel/{city_slug}-mg-brasil"
        driver.get(url)
        time.sleep(4)

        collected = 0
        prev_count = 0

        while True:
            cards = driver.find_elements(By.CSS_SELECTOR, '[data-testid="house-card-container"]')
            log(f"[QuintoAndar] Encontrados {len(cards)} cards.")
            for card in cards[prev_count:]:
                try:
                    nome = ""
                    try:
                        nome = card.find_element(By.CSS_SELECTOR, 'h2').text
                    except Exception:
                        pass
                    imagem = ""
                    try:
                        imagem = card.find_element(By.TAG_NAME, 'img').get_attribute('src')
                    except Exception:
                        pass
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, 'div.Cozy__CardTitle-Title').text
                    except Exception:
                        pass
                    detalhes = ""
                    try:
                        detalhes = card.find_element(By.CSS_SELECTOR, 'h3').text
                    except Exception:
                        pass
                    localizacao = ""
                    try:
                        localizacao = card.find_element(By.CSS_SELECTOR, 'h2').text
                    except Exception:
                        pass
                    link = ""
                    try:
                        link = card.find_element(By.TAG_NAME, 'a').get_attribute('href')
                    except Exception:
                        pass

                    m2 = quartos = garagem = ""
                    partes = detalhes.split('·') if detalhes else []
                    if len(partes) > 0:
                        m2 = partes[0].strip()
                    if len(partes) > 1:
                        quartos = partes[1].strip()
                    garagem = "1" if "garagem" in (detalhes or "").lower() else "0"

                    emit({
                        "site": "QuintoAndar",
                        "nome": nome or "",
                        "imagem": sanitize_image(imagem),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": quartos,
                        "garagem": garagem,
                    })
                    collected += 1
                except Exception as e:
                    log(f"[QuintoAndar] Erro ao extrair card: {e}")
                    continue

            # tenta clicar no botão 'Ver mais'
            try:
                botao_ver_mais = wait.until(EC.presence_of_element_located((By.ID, 'see-more')))
                driver.execute_script("arguments[0].scrollIntoView();", botao_ver_mais)
                time.sleep(0.8)
                driver.execute_script("arguments[0].click();", botao_ver_mais)
                # espera por novos cards
                for _ in range(10):
                    time.sleep(1.0)
                    new_cards = driver.find_elements(By.CSS_SELECTOR, '[data-testid="house-card-container"]')
                    if len(new_cards) > len(cards):
                        prev_count = len(cards)
                        break
                else:
                    # se não carregou novos cards, encerra
                    log("[QuintoAndar] Nenhum novo card carregado após clicar 'Ver mais'.")
                    break
            except Exception as e:
                log(f"[QuintoAndar] Botão 'Ver mais' não encontrado ou erro: {e}")
                break

        log(f"[QuintoAndar] Emitidos: {collected}")
    except Exception as e:
        log(f"[QuintoAndar] Erro geral: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[QuintoAndar] Finalizado.")


def scraping_zapimoveis(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Implementação baseada no script scraper_zapimoveis.py:
    - percorre páginas usando botão next (data-testid="next-page")
    - extrai title, imagem, price, features (m², quartos, vaga), address e link
    """
    log("[ZapImoveis] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 12)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "Belo Horizonte")
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]
        city_segment = parts[1].replace(' ', '-') if len(parts) >= 2 else raw_end.replace(' ', '-')
        base = f"https://www.zapimoveis.com.br/venda/casas/mg+{city_segment}?precoMaximo={filtros.get('valorMax','') or ''}"
        driver.get(base)
        time.sleep(4)

        page = 1
        total = 0
        while True:
            cards = driver.find_elements(By.CSS_SELECTOR, '[data-testid="property-card"], li[data-cy="rp-property-cd"], article')
            log(f"[ZapImoveis] Encontrados {len(cards)} cards na página {page}.")
            for card in cards:
                try:
                    titulo = ""
                    try:
                        titulo = card.find_element(By.CSS_SELECTOR, '[data-testid="card-title"]').text
                    except Exception:
                        try:
                            titulo = card.find_element(By.CSS_SELECTOR, '[data-cy="rp-cardProperty-location-txt"]').text
                        except Exception:
                            pass
                    imagem = ""
                    try:
                        imagem = card.find_element(By.CSS_SELECTOR, 'img').get_attribute('src')
                    except Exception:
                        pass
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, '[data-testid="price"], [data-cy="rp-cardProperty-price-txt"] > p').text
                    except Exception:
                        pass
                    detalhes = card.find_elements(By.CSS_SELECTOR, '[data-testid="feature-item"], [data-cy*="FEATURE"], [data-qa="POSTING_CARD_FEATURES"] span')
                    m2 = quartos = garagem = ''
                    for d in detalhes:
                        txt = d.text.lower()
                        if 'm²' in txt or 'm2' in txt:
                            m2 = d.text
                        elif 'quarto' in txt or 'quartos' in txt:
                            quartos = d.text
                        elif 'vaga' in txt or 'vagas' in txt:
                            garagem = d.text
                    localizacao = ""
                    try:
                        localizacao = card.find_element(By.CSS_SELECTOR, '[data-testid="address"], [data-cy="rp-cardProperty-street-txt"], [data-qa="POSTING_CARD_LOCATION"]').text
                    except Exception:
                        pass
                    link = ""
                    try:
                        link = card.find_element(By.TAG_NAME, 'a').get_attribute('href')
                    except Exception:
                        pass

                    emit({
                        "site": "ZapImoveis",
                        "nome": titulo or "",
                        "imagem": sanitize_image(imagem),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": quartos,
                        "garagem": garagem,
                    })
                    total += 1
                except Exception as e:
                    log(f"[ZapImoveis] Erro ao extrair card: {e}")
                    continue

            # tentar navegar para próxima página
            try:
                botao_proximo = None
                # tenta seletor data-testid next-page
                try:
                    botao_proximo = driver.find_element(By.CSS_SELECTOR, 'button[data-testid="next-page"]')
                except Exception:
                    # outras alternativas
                    try:
                        botao_proximo = driver.find_element(By.XPATH, '//button[@aria-label[contains(.,"Próxima")]]')
                    except Exception:
                        botao_proximo = None
                if not botao_proximo:
                    # tenta link rel=next
                    try:
                        a_next = driver.find_element(By.CSS_SELECTOR, 'a[rel="next"]')
                        href = a_next.get_attribute('href')
                        if href:
                            driver.get(href)
                            page += 1
                            time.sleep(4)
                            continue
                        else:
                            break
                    except Exception:
                        break
                driver.execute_script("arguments[0].click();", botao_proximo)
                page += 1
                time.sleep(4)
            except Exception as e:
                log(f"[ZapImoveis] Paginação finalizada ou erro: {e}")
                break

        log(f"[ZapImoveis] Emitidos: {total}")
    except Exception as e:
        log(f"[ZapImoveis] Erro geral: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[ZapImoveis] Finalizado.")


def scraping_vivareal(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Corrige a geração de URL do VivaReal para respeitar filtros de tipo e preço.

    Problema anterior:
    - A versão anterior do scraper apenas montava a path base (cidade/bairro)
      e paginava com ?pagina=N, sem passar os parâmetros 'tipos' e 'precoMaximo'
      na query string, por isso os resultados vinham sem os filtros aplicados.

    Correção:
    - Monta a URL com os parâmetros transacao=venda, tipos=<tipos mapeados> e precoMaximo=<valor>
    - Normaliza tokens de tipo do filtro (ex: "apartamentos" -> "apartamento_residencial",
      "casas" -> "casa_residencial") e aceita várias formas de entrada.
    - Continua a paginação via ?pagina=N.
    """
    log("[VivaReal] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 12)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "belo horizonte").lower().strip()
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]

        if len(parts) >= 2:
            city = parts[1].replace(" ", "-")
            bairro = parts[0].replace(" ", "-")
            base = f"https://www.vivareal.com.br/venda/minas-gerais/{city}/bairros/{bairro}/"
        else:
            city = raw_end.replace(" ", "-")
            base = f"https://www.vivareal.com.br/venda/minas-gerais/{city}/"

        # Normaliza tokens de tipo para o formato que o VivaReal costuma usar
        def map_tipo_token(tok: str) -> Optional[str]:
            t = (tok or "").strip().lower()
            if not t:
                return None
            if "apart" in t:
                return "apartamento_residencial"
            if "cobertura" in t:
                return "cobertura_residencial"
            if "casa" in t:
                return "casa_residencial"
            if "loja" in t:
                return "loja_comercial"
            if "sala" in t:
                return "sala_comercial"
            if "terreno" in t or "lote" in t:
                return "terreno"
            # fallback simples: substitui espaços por underscore e retorna
            return t.replace(" ", "_")

        tipo_raw = (filtros.get("tipo_imovel") or "").strip()
        mapped_tipos = []
        if tipo_raw:
            tokens = [t.strip() for t in re.split(r'[,;~\+]+', tipo_raw) if t.strip()]
            for tk in tokens:
                mt = map_tipo_token(tk)
                if mt and mt not in mapped_tipos:
                    mapped_tipos.append(mt)

        tipos_param = ",".join(mapped_tipos) if mapped_tipos else ""

        # normaliza preço máximo (somente dígitos)
        valor_raw = filtros.get("valorMax") or filtros.get("preco_max") or filtros.get("precoMax") or filtros.get("precoMaximo") or ""
        valor_digits = "".join([c for c in str(valor_raw) if c.isdigit()])

        total = 0
        # paginação com ?pagina=N, incluindo outros parâmetros (transacao, tipos, precoMaximo)
        for page in range(1, 25):
            params: Dict[str, Any] = {"transacao": "venda", "pagina": str(page)}
            if tipos_param:
                params["tipos"] = tipos_param
            if valor_digits:
                params["precoMaximo"] = valor_digits  # param usado no exemplo que você forneceu

            url = f"{base}?{urllib.parse.urlencode(params, doseq=True)}"
            log(f"[VivaReal] Acessando: {url}")
            try:
                driver.get(url)
            except Exception as e:
                log(f"[VivaReal] Erro ao carregar {url}: {e}")
                break
            time.sleep(3)

            cards = driver.find_elements(By.CSS_SELECTOR, 'li[data-cy="rp-property-cd"], .results__card, article')  # seletores mistos para robustez
            log(f"[VivaReal] Página {page} - {len(cards)} cards encontrados.")
            if not cards:
                # Se não encontrou nada na primeira página, pode ser que o site bloqueie o webdriver,
                # ou que o formato de tipos não seja o esperado. Saímos para evitar loops longos.
                if page == 1:
                    log("[VivaReal] Nenhum card encontrado na primeira página — verifique se o site mudou os seletores ou se bloqueou o acesso.")
                break

            for card in cards:
                try:
                    link = ""
                    try:
                        link = card.find_element(By.TAG_NAME, "a").get_attribute("href")
                    except Exception:
                        pass
                    img = ""
                    try:
                        img = card.find_element(By.CSS_SELECTOR, "img").get_attribute("src")
                    except Exception:
                        pass
                    titulo = ""
                    try:
                        titulo = card.find_element(By.CSS_SELECTOR, '[data-cy="rp-cardProperty-location-txt"], .posting-card__title, h2, h3').text
                    except Exception:
                        pass
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, '[data-cy="rp-cardProperty-price-txt"], .postingCard-module__price, .price').text
                    except Exception:
                        # fallback: buscar padrão R$ no texto do card
                        try:
                            m = re.search(r'R\$[\s\d\.\,]+', card.text)
                            if m:
                                valor = m.group(0)
                        except Exception:
                            valor = ""
                    m2 = ""
                    try:
                        m2 = card.find_element(By.CSS_SELECTOR, '[data-cy="rp-cardProperty-propertyArea-txt"], .area').text
                    except Exception:
                        # procurar por "m²" no texto do card
                        try:
                            m = re.search(r'[\d\.,]+\s?m(?:²|2)\b', card.text)
                            if m:
                                m2 = m.group(0)
                        except Exception:
                            m2 = ""
                    localizacao = ""
                    try:
                        localizacao = card.find_element(By.CSS_SELECTOR, '[data-cy="rp-cardProperty-street-txt"], .postingCard-module__location').text
                    except Exception:
                        pass

                    emit({
                        "site": "VivaReal",
                        "nome": titulo or "",
                        "imagem": sanitize_image(img),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": "",
                        "garagem": "",
                    })
                    total += 1
                except Exception as e:
                    log(f"[VivaReal] Erro ao extrair card: {e}")
                    continue
            # continuar paginação
            # Se o site não forneceu botão next ou se o selector muda, o loop será quebrado pela ausência de cards na próxima iteração
            time.sleep(1)
        log(f"[VivaReal] Emitidos: {total}")
    except Exception as e:
        log(f"[VivaReal] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[VivaReal] Finalizado.")


def scraping_casamineira(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Versão melhorada para montar corretamente o segmento de 'tipo' aceitável pela CasaMineira,
    normalizar valores e tentar ordens alternativas caso o site responda com handleUrlNotRecognize.

    Estratégia:
    - normaliza tokens (plural -> singular, 'apartamentos' -> 'apartamento', 'casas' -> 'casa', ...)
    - monta alguns candidatos de tipo (ordem original, ordem canônica, ordem invertida)
    - tenta cada URL até encontrar uma que não seja redirecionada para handleUrlNotRecognize
      ou que retorne cards (>0). Se nenhuma funcionar, usa a última tentativa (fallback).
    - preserva fallback de aplicar filtros via DOM, mas a URL é a principal via de filtragem.
    """
    log("[Casa Mineira] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 15)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "belo horizonte").lower().strip()
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]
        if len(parts) >= 2:
            endereco_formatado = f"{parts[0].replace(' ', '-')}_{parts[1].replace(' ', '-')}"
        else:
            endereco_formatado = raw_end.replace(" ", "-")

        # Normalização dos tokens de tipo -> slug usado pelo site (singular)
        def normalize_tipo_token(tok: str) -> Optional[str]:
            t = (tok or "").strip().lower()
            if not t:
                return None
            # heurísticas comuns
            if "apart" in t:
                return "apartamento"
            if "cobertura" in t:
                return "cobertura"
            if "casa" in t:
                return "casa"
            if "loja" in t:
                return "loja"
            if "sala" in t:
                return "sala"
            if "lote" in t or "terreno" in t:
                return "lote"
            if "kit" in t:
                return "kitnet"
            # fallback: remove plural trailing s
            t2 = re.sub(r's$', '', t)
            # sanitize spaces -> hyphen
            return t2.replace(" ", "-")

        # Extrai tokens da entrada (aceita vários separadores)
        tipo_raw = (filtros.get("tipo_imovel") or "").strip()
        tokens_input = []
        if tipo_raw:
            tokens_input = [t.strip() for t in re.split(r'[,;~\+]+', tipo_raw) if t.strip()]

        # mapear e manter ordem única preservando primeira ocorrência
        seen = []
        for t in tokens_input:
            nt = normalize_tipo_token(t)
            if nt and nt not in seen:
                seen.append(nt)

        # se não passou tipo, mantemos vazio (vai usar /venda/casa/... como default)
        normalized_tokens = seen

        # ordem canônica que o site costuma entender melhor (prioriza 'casa' antes de 'apartamento')
        canonical_order = ["casa", "apartamento", "cobertura", "loja", "sala", "lote", "kitnet"]

        # gera candidatos de segmento tipo:
        candidates = []
        if normalized_tokens:
            # 1) ordem como fornecida
            candidates.append("+".join(normalized_tokens))
            # 2) tentativa em ordem canônica (interseção preservando ordem canônica)
            ordered = [t for t in canonical_order if t in normalized_tokens]
            # acrescente quaisquer tokens não mapeados pela canônica (no final)
            ordered += [t for t in normalized_tokens if t not in ordered]
            if ordered and "+".join(ordered) not in candidates:
                candidates.append("+".join(ordered))
            # 3) ordem invertida (alguns sites aceitam apenas uma ordem)
            rev = list(reversed(normalized_tokens))
            if rev and "+".join(rev) not in candidates:
                candidates.append("+".join(rev))
        else:
            # sem tipo informado -> deixar vazio (vai usar /venda/casa/ como fallback)
            candidates.append("")

        # extrai valor max normalizado (somente dígitos)
        valor_raw = filtros.get("valorMax") or filtros.get("preco_max") or filtros.get("precoMax") or ""
        valor_digits = "".join([c for c in str(valor_raw) if c.isdigit()])

        # função que monta URL a partir de tipo_segment candidato
        def build_url_with_tipo(tipo_segment: str) -> str:
            if tipo_segment:
                base = f"https://www.casamineira.com.br/venda/{tipo_segment}/{endereco_formatado}_mg"
            else:
                base = f"https://www.casamineira.com.br/venda/casa/{endereco_formatado}_mg"
            if valor_digits:
                if not base.endswith("/"):
                    base = base + "/"
                base = f"{base}preco-maximo-{valor_digits}"
            return base

        # tentativas: para cada candidato, acessar e verificar se houve redirecionamento estranho
        final_url = None
        cards_found = 0
        tried_urls = []
        for tipo_seg in candidates:
            url = build_url_with_tipo(tipo_seg)
            tried_urls.append(url)
            log(f"[Casa Mineira] Tentando URL: {url}")
            try:
                driver.get(url)
            except Exception as e:
                log(f"[Casa Mineira] Erro ao acessar {url}: {e}")
                continue
            time.sleep(3)

            current = driver.current_url or ""
            # conta cards rapidamente
            try:
                cards = driver.find_elements(By.CSS_SELECTOR, '.postingCardLayout-module__posting-card-layout')
                cards_found = len(cards)
            except Exception:
                cards_found = 0

            # detecta redirect genérico de URL não reconhecida
            redirected_bad = False
            if "handleUrlNotRecognize" in current or "listingUrlResolver" in current or "/handleUrlNotRecognize" in current:
                redirected_bad = True

            log(f"[Casa Mineira] Acessada (real): {current} | cards={cards_found} | redirect_bad={redirected_bad}")

            # se não houve redirect ruim e temos pelo menos 1 card, aceitamos
            if not redirected_bad and cards_found > 0:
                final_url = url
                log(f"[Casa Mineira] URL válida encontrada: {url}")
                break

            # se não encontrou cards mas não foi redirect ruim, podemos aceitar também (pode ser realmente zero resultados)
            if not redirected_bad and cards_found == 0:
                # aceitar como resultado (não forçar outras tentativas) — mas registramos e seguir extração normal
                final_url = url
                log(f"[Casa Mineira] URL sem redirecionamento; aceita como válida (0 cards). URL: {url}")
                break

            # caso contrário continue tentando outras ordens
            log(f"[Casa Mineira] URL rejeitada pelo site (handleUrlNotRecognize) ou sem retorno; tentando próxima opção...")
            # continue loop tentando próximo candidato

        # se nenhuma candidata funcionou (final_url None), usar a primeira montada como fallback
        if final_url is None:
            final_url = build_url_with_tipo(candidates[0] if candidates else "")
            log(f"[Casa Mineira] Nenhuma URL candidata funcionou — usando fallback: {final_url}")
            try:
                driver.get(final_url)
                time.sleep(3)
            except Exception as e:
                log(f"[Casa Mineira] Erro no fallback: {e}")

        # agora extrair normalmente da página atual (pode ser a última carregada)
        total = 0
        while True:
            try:
                cards = driver.find_elements(By.CSS_SELECTOR, '.postingCardLayout-module__posting-card-layout')
                log(f"[Casa Mineira] Encontrados {len(cards)} cards nesta página.")
                for card in cards:
                    try:
                        titulo = ""
                        try:
                            titulo = card.find_element(By.CSS_SELECTOR, '.postingCard-module__posting-description a').text
                        except Exception:
                            pass
                        imagem = ""
                        try:
                            imagem = card.find_element(By.CSS_SELECTOR, 'img').get_attribute('src')
                        except Exception:
                            pass
                        valor = ""
                        try:
                            valor = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_PRICE"]').text
                        except Exception:
                            pass
                        detalhes = card.find_elements(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_FEATURES"] span')
                        m2 = quartos = garagem = ''
                        for d in detalhes:
                            txt = d.text
                            if 'm²' in txt:
                                m2 = txt
                            elif 'quarto' in txt:
                                quartos = txt
                            elif 'vaga' in txt:
                                garagem = txt
                        localizacao = ""
                        try:
                            localizacao = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_LOCATION"]').text
                        except Exception:
                            pass
                        link = ""
                        try:
                            link = card.find_element(By.CSS_SELECTOR, '.postingCard-module__posting-description a').get_attribute('href')
                        except Exception:
                            pass

                        emit({
                            "site": "CasaMineira",
                            "nome": titulo or "",
                            "imagem": sanitize_image(imagem),
                            "valor": valor or "",
                            "m2": m2,
                            "localizacao": localizacao,
                            "link": link,
                            "quartos": quartos,
                            "garagem": garagem,
                        })
                        total += 1
                    except Exception as e:
                        log(f"[Casa Mineira] Erro ao extrair card: {e}")
                        continue

                # tenta próxima página
                try:
                    botao_proximo = driver.find_element(By.CSS_SELECTOR, 'a[data-qa="PAGING_NEXT"]')
                    if not botao_proximo:
                        break
                    driver.execute_script("arguments[0].scrollIntoView(true);", botao_proximo)
                    time.sleep(0.4)
                    botao_proximo.click()
                    time.sleep(3)
                except Exception:
                    break
            except Exception as e:
                log(f"[Casa Mineira] Erro geral na paginação/extracao: {e}")
                break

        log(f"[Casa Mineira] Emitidos: {total}")
    except Exception as e:
        log(f"[Casa Mineira] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[Casa Mineira] Finalizado.")

def scraping_imovelweb(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Corrigido para montar a URL do ImovelWeb respeitando:
    - tipos (ex: casas, apartamentos) no segmento inicial (ex: casas-apartamentos-venda-...),
    - bairro + cidade quando fornecidos (ex: barreiro-belo-horizonte),
    - filtro de preço máximo no final no formato '-menos-<valor>-reales.html' quando valorMax for passado.

    Estratégia:
    - normaliza tokens de tipo para as formas que o site costuma aceitar (plural: 'casas', 'apartamentos'),
    - gera candidatos (ordem fornecida, ordem canônica, ordem invertida) e tenta cada um até carregar a página,
      aceitando a primeira URL que não explicitamente redirecione para páginas de erro/resolver (se há redirect)
      ou até a primeira que carregue (mesmo que retorne 0 resultados).
    - extrai cards usando seletores já presentes (faz fallback para vários seletores comuns).
    """
    log("[Imovelweb] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 10)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "belo horizonte").lower().strip()
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]
        bairro = ""
        cidade = ""
        if len(parts) >= 2:
            bairro = parts[0].replace(" ", "-")
            cidade = parts[1].replace(" ", "-")
        else:
            # Se só informou cidade, usamos como cidade
            cidade = raw_end.replace(" ", "-")

        # Normalização de tokens de tipo para o ImovelWeb (plural)
        def map_tipo(tok: str) -> Optional[str]:
            t = (tok or "").strip().lower()
            if not t:
                return None
            if "apart" in t:
                return "apartamentos"
            if "cobertura" in t:
                return "coberturas"
            if "casa" in t:
                return "casas"
            if "loja" in t:
                return "lojas"
            if "sala" in t:
                return "salas"
            if "lote" in t or "terreno" in t:
                return "lotes"
            # fallback: remove final 's' and add 's' to keep plural-ish
            t2 = re.sub(r'\s+', '-', t)
            if not t2.endswith('s'):
                t2 = t2 + "s"
            return t2

        tipo_raw = (filtros.get("tipo_imovel") or "").strip()
        input_tokens = []
        if tipo_raw:
            input_tokens = [t.strip() for t in re.split(r'[,;~\+]+', tipo_raw) if t.strip()]

        mapped = []
        for t in input_tokens:
            m = map_tipo(t)
            if m and m not in mapped:
                mapped.append(m)

        # Se não informou tipo, tentamos inferir a partir do campo 'tipo_imovel' simples (mantemos 'imoveis' como fallback)
        if not mapped:
            # tentar inferir a partir de palavras comuns (ex: se filtro cliente já tem 'apartamentos' selecionado)
            # mas por segurança deixamos 'imoveis' se nada informado
            mapped = []

        # Ordem canônica preferida (casas antes de apartamentos costuma aparecer no exemplo)
        canonical_order = ["casas", "apartamentos", "coberturas", "lojas", "salas", "lotes"]

        candidates = []
        if mapped:
            # 1) ordem como fornecida, join com '-'
            candidates.append("-".join(mapped))
            # 2) ordem canônica (intersecção)
            ordered = [t for t in canonical_order if t in mapped]
            ordered += [t for t in mapped if t not in ordered]
            if ordered and "-".join(ordered) not in candidates:
                candidates.append("-".join(ordered))
            # 3) invertida
            rev = list(reversed(mapped))
            if rev and "-".join(rev) not in candidates:
                candidates.append("-".join(rev))
        else:
            # usar categoria genérica 'imoveis' ou tentar 'casas-apartamentos' como alternativa
            candidates.append("imoveis")
            candidates.append("casas-apartamentos")

        # normaliza valorMax
        valor_raw = filtros.get("valorMax") or filtros.get("preco_max") or filtros.get("precoMax") or ""
        valor_digits = "".join([c for c in str(valor_raw) if c.isdigit()])

        def build_url(tipo_segment: str) -> str:
            # Monta a parte cidade/bairro
            if bairro:
                place = f"{bairro}-{cidade}"
            else:
                place = f"{cidade}"
            # tipo_segment já vem sem traços extras
            # Ex.: https://www.imovelweb.com.br/casas-apartamentos-venda-barreiro-belo-horizonte-menos-500000-reales.html
            price_part = f"-menos-{valor_digits}-reales" if valor_digits else ""
            url = f"https://www.imovelweb.com.br/{tipo_segment}-venda-{place}{price_part}.html"
            return url

        final_url = None
        for tipo_seg in candidates:
            url = build_url(tipo_seg)
            log(f"[Imovelweb] Tentando URL: {url}")
            try:
                driver.get(url)
            except Exception as e:
                log(f"[Imovelweb] Erro ao acessar {url}: {e}")
                continue
            time.sleep(3)
            current = (driver.current_url or "").lower()
            # detecta redirects / páginas de erro (heurística)
            if "handleurlnotrecognize" in current or "listingurlresolver" in current or "error" in current:
                log(f"[Imovelweb] Redirect/erro detectado ao acessar: {current} (tentando próximo candidato)")
                continue
            # se carregou sem redirect, aceitamos essa URL (mesmo que retorne 0 cards)
            final_url = url
            log(f"[Imovelweb] URL aceita: {final_url}")
            break

        # fallback: se nenhuma url candidata funcionou, montar URL genérica sem tipo e sem preço
        if not final_url:
            if bairro:
                final_url = f"https://www.imovelweb.com.br/imoveis-venda-{bairro}-{cidade}.html"
            else:
                final_url = f"https://www.imovelweb.com.br/imoveis-venda-{cidade}.html"
            log(f"[Imovelweb] Nenhuma candidata funcionou; usando fallback: {final_url}")
            try:
                driver.get(final_url)
            except Exception as e:
                log(f"[Imovelweb] Erro no fallback: {e}")
            time.sleep(2)

        # Extrair cards da página atual (a que foi aceita ou fallback)
        total = 0
        try:
            cards = driver.find_elements(By.CSS_SELECTOR, '.postingCardLayout-module__posting-card-container, .postingCardLayout-module__posting-card-layout, article')
            log(f"[Imovelweb] Encontrados {len(cards)} cards.")
        except Exception as e:
            log(f"[Imovelweb] Erro ao buscar cards: {e}")
            cards = []

        for card in cards:
            try:
                link = ""
                try:
                    link = card.find_element(By.TAG_NAME, 'a').get_attribute('href')
                except Exception:
                    pass
                imagem = ""
                try:
                    imagem = card.find_element(By.CSS_SELECTOR, 'img').get_attribute('src')
                except Exception:
                    pass
                titulo = ""
                try:
                    titulo = card.find_element(By.CSS_SELECTOR, 'h3, h2').text
                except Exception:
                    pass
                valor = ""
                try:
                    # selectors variados
                    valor = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_PRICE"], .price, .postingCard-module__price').text
                except Exception:
                    # fallback: procurar qualquer texto que pareça ser preço no card
                    try:
                        txt = card.text
                        m = re.search(r'R\$[\s\d\.\,]+', txt)
                        if m:
                            valor = m.group(0)
                    except Exception:
                        valor = ""
                localizacao = ""
                try:
                    localizacao = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_LOCATION"], .location').text
                except Exception:
                    pass
                m2 = ""
                try:
                    caracteristicas = card.find_elements(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_FEATURES"] span, .features span')
                    for c in caracteristicas:
                        if 'm²' in c.text or 'm2' in c.text:
                            m2 = c.text
                except Exception:
                    pass

                emit({
                    "site": "Imovelweb",
                    "nome": titulo or "",
                    "imagem": sanitize_image(imagem),
                    "valor": valor or "",
                    "m2": m2,
                    "localizacao": localizacao,
                    "link": link,
                    "quartos": '',
                    "garagem": '',
                })
                total += 1
            except Exception as e:
                log(f"[Imovelweb] Erro ao extrair card: {e}")
                continue

        log(f"[Imovelweb] Emitidos: {total}")
    except Exception as e:
        log(f"[Imovelweb] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[Imovelweb] Finalizado.")

def scraping_olx(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Implementação baseada em OLX.py:
    - abre lista, aplica filtros básicos se fornecidos, percorre paginação via link 'Próxima página'
    - extrai seção 'section.olx-adcard'
    """
    log("[OLX] Iniciando...")
    driver = build_firefox(headless=headless)
    wait = WebDriverWait(driver, 10)
    try:
        cidade = (filtros.get("cidade") or "belo horizonte").strip().lower().replace(" ", "-")
        url = f"https://www.olx.com.br/imoveis/venda/estado-mg/{cidade}-e-regiao"
        log(f"[OLX] Acessando: {url}")
        driver.get(url)
        time.sleep(4)

        # aplicar filtros básicos via DOM (se houver)
        try:
            if filtros.get('preco_min'):
                try:
                    el = driver.find_element(By.ID, "price_min")
                    el.clear(); el.send_keys(str(filtros.get('preco_min')))
                except Exception:
                    pass
            if filtros.get('preco_max'):
                try:
                    el = driver.find_element(By.ID, "price_max")
                    el.clear(); el.send_keys(str(filtros.get('preco_max')))
                except Exception:
                    pass
            time.sleep(1)
        except Exception:
            pass

        total = 0
        while True:
            cards = driver.find_elements(By.CSS_SELECTOR, 'section.olx-adcard, section.olx-ad-card, .sc-1fcmfeb-2')
            log(f"[OLX] Encontrados {len(cards)} cards nesta página.")
            for card in cards:
                try:
                    titulo = ""
                    try:
                        titulo = card.find_element(By.CSS_SELECTOR, 'h2').text
                    except Exception:
                        pass
                    imagem = ""
                    try:
                        imagem = card.find_element(By.CSS_SELECTOR, 'img').get_attribute('src')
                    except Exception:
                        pass
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, 'h3').text
                    except Exception:
                        pass
                    detalhes = card.find_elements(By.CSS_SELECTOR, '.olx-adcard__detail, .sc-1fcmfeb-3')
                    m2 = quartos = garagem = ''
                    for d in detalhes:
                        try:
                            txt = (d.get_attribute('aria-label') or d.text or "").lower()
                        except Exception:
                            txt = (d.text or "").lower()
                        if 'metro' in txt or 'm²' in txt or 'm2' in txt:
                            m2 = d.text
                        elif 'quarto' in txt:
                            quartos = d.text
                        elif 'vaga' in txt:
                            garagem = d.text
                    localizacao = ""
                    try:
                        localizacao = card.find_element(By.CSS_SELECTOR, '.olx-adcard__location, .sc-1fcmfeb-4').text
                    except Exception:
                        pass
                    link = ""
                    try:
                        link = card.find_element(By.CSS_SELECTOR, 'a').get_attribute('href')
                    except Exception:
                        pass

                    emit({
                        "site": "OLX",
                        "nome": titulo or "",
                        "imagem": sanitize_image(imagem),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": quartos,
                        "garagem": garagem,
                    })
                    total += 1
                except Exception:
                    continue

            # paginação: tenta encontrar link 'Próxima página'
            try:
                # busca botão/anchor com texto Próxima página
                try:
                    botao = driver.find_element(By.XPATH, '//a[contains(., "Próxima página") or contains(., "Próxima") or contains(., "Próxima página")]')
                    href = botao.get_attribute('href')
                    if not href:
                        break
                    driver.get(href)
                    time.sleep(3)
                    continue
                except Exception:
                    # tentar botão interno
                    try:
                        button_next = driver.find_element(By.XPATH, '//button[contains(.,"Próxima página") or contains(.,"Próxima")]')
                        href = button_next.get_attribute('href')
                        if href:
                            driver.get(href)
                            time.sleep(3)
                            continue
                        else:
                            # click if possible
                            driver.execute_script("arguments[0].click();", button_next)
                            time.sleep(3)
                            continue
                    except Exception:
                        break
            except Exception:
                break

        log(f"[OLX] Emitidos: {total}")
    except Exception as e:
        log(f"[OLX] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[OLX] Finalizado.")




import re
import time
from selenium.webdriver.common.by import By

def scraping_loft(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    log("[Loft] Iniciando (correção m² / endereço)...")
    driver = build_firefox(headless=headless)
    try:
        raw_end = str(filtros.get("endereco") or filtros.get("cidade") or "belo horizonte").lower().strip()
        parts = [p.strip() for p in re.split(r"[,]+", raw_end) if p.strip()]
        if len(parts) >= 2:
            bairro = parts[0].replace(' ', '-'); city = parts[1].replace(' ', '-')
            url_base = f"https://loft.com.br/venda/imoveis/mg/{city}/{bairro}_{city}_mg"
        else:
            city_slug = raw_end.replace(' ', '-'); url_base = f"https://loft.com.br/venda/imoveis/mg/{city_slug}"

        params: Dict[str, Any] = {}
        if filtros.get("valorMax"):
            params["precoMax"] = filtros.get("valorMax")
        if filtros.get("areaMin"):
            params["areaMin"] = filtros.get("areaMin")
        tipo_raw = (filtros.get("tipo_imovel") or "").strip()
        if tipo_raw:
            tipo_val = "~".join([t.strip() for t in re.split(r'[,;~]+', tipo_raw) if t.strip()])
            params["tipo-de-imovel"] = tipo_val
        params["transacao"] = "venda"

        qs = ("?" + urllib.parse.urlencode({k: v for k, v in params.items() if v}, doseq=True)) if params else ""
        total = 0
        for page in range(1, 25):
            url = f"{url_base}{qs}"
            if page > 1:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}pagina={page}"
            try:
                driver.get(url)
            except Exception:
                break
            time.sleep(2.5)

            cards = driver.find_elements(By.CSS_SELECTOR, 'a.MuiCardActionArea-root')
            if not cards:
                break
            log(f"[Loft] Página {page} - {len(cards)} cards encontrados.")
            for card in cards:
                try:
                    link = card.get_attribute('href') or ""
                    # imagem
                    imagem = ""
                    try:
                        img_el = card.find_element(By.CSS_SELECTOR, 'img')
                        imagem = img_el.get_attribute('src') or img_el.get_attribute('data-src') or ""
                    except Exception:
                        imagem = ""

                    # título (se existir)
                    titulo = ""
                    try:
                        titulo = card.find_element(By.CSS_SELECTOR, 'h2').text.strip()
                    except Exception:
                        titulo = ""

                    # endereço: normalmente está em <h3> dentro do card
                    localizacao = ""
                    try:
                        h3 = card.find_element(By.CSS_SELECTOR, 'h3')
                        localizacao = h3.text.strip()
                    except Exception:
                        # fallback heurístico: tenta extrair a linha que se parece com um endereço do texto todo do card
                        try:
                            ct = card.text
                            # procura por linhas com vírgula ou palavra de bairro (heurística)
                            lines = [l.strip() for l in ct.splitlines() if l.strip()]
                            addr = ""
                            for ln in lines:
                                # ex: "R. Cândido de Souza, Nova Gameleira"
                                if ("," in ln and any(c.isalpha() for c in ln)) and len(ln.split()) > 2:
                                    addr = ln
                                    break
                            localizacao = addr
                        except Exception:
                            localizacao = ""

                    # area (m²): pegar via regex no texto do card (cobre formatos com ponto/virgula/espaço)
                    m2 = ""
                    try:
                        txt = card.text.replace('\xa0', ' ')
                        # regex aceita "48m²", "48 m²", "276.00m²", "48m2"
                        m = re.search(r'[\d\.,]+\s?m(?:²|2)\b', txt, flags=re.IGNORECASE)
                        if m:
                            m2 = m.group(0)
                        else:
                            # alternativa: procura por pattern com "m" seguido de número antes (algumas UIs mostram "48m²" sem espaço)
                            m_alt = re.search(r'(\d{1,3}(?:[.,]\d{1,3})?)\s?m\b', txt, flags=re.IGNORECASE)
                            if m_alt:
                                m2 = m_alt.group(0)
                    except Exception:
                        m2 = ""

                    # valor
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, 'span[class*="MuiTypography-root"]').text.strip()
                    except Exception:
                        valor = ""

                    emit({
                        "site": "Loft",
                        "nome": titulo or "",
                        "imagem": sanitize_image(imagem),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": '',
                        "garagem": '',
                    })
                    total += 1
                except Exception as e:
                    log(f"[Loft] Erro ao extrair card: {e}")
                    continue
        log(f"[Loft] Emitidos: {total}")
    except Exception as e:
        log(f"[Loft] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[Loft] Finalizado.")


def scraping_chavesnamao(emit: Callable[[Dict[str, Any]], None], filtros: FiltrosType, headless: bool = True):
    """
    Implementação baseada em CHAVE NA MÃO FUNCIONAL.py:
    - monta URL com tipo/cidade
    - faz scroll/rolagem para carregar e coleta 'div[data-template="list"]'
    """
    log("[ChavesNaMao] Iniciando...")
    driver = build_firefox(headless=headless)
    try:
        raw_tipo = (filtros.get("tipo_imovel") or "").strip().lower()
        cidade = (filtros.get("cidade") or filtros.get("endereco") or "belo horizonte").strip().lower().replace(" ", "-")
        tipo_segment = raw_tipo if raw_tipo else "casas-a-venda"
        base_url = f"https://www.chavesnamao.com.br/{tipo_segment}/mg-{cidade}/"
        log(f"[ChavesNaMao] Acessando: {base_url}")
        driver.get(base_url)
        time.sleep(4)

        last_height = driver.execute_script("return document.body.scrollHeight")
        total = 0
        attempts = 0
        while True:
            cards = driver.find_elements(By.CSS_SELECTOR, 'div[data-template="list"]')
            log(f"[ChavesNaMao] Encontrados {len(cards)} cards na página/rolagem.")
            for card in cards:
                try:
                    titulo = ""
                    try:
                        titulo = card.find_element(By.CSS_SELECTOR, 'h2').text
                    except Exception:
                        pass
                    imagem = ""
                    try:
                        imagem = card.find_element(By.CSS_SELECTOR, 'img').get_attribute('src')
                    except Exception:
                        pass
                    valor = ""
                    try:
                        valor = card.find_element(By.CSS_SELECTOR, 'p[aria-label="Preço"] b').text
                    except Exception:
                        pass
                    link = ""
                    try:
                        link = card.find_element(By.CSS_SELECTOR, 'a').get_attribute('href')
                    except Exception:
                        pass
                    localizacao = ""
                    try:
                        local = card.find_elements(By.CSS_SELECTOR, 'address p'); localizacao = local[-1].text if local else ''
                    except Exception:
                        pass
                    detalhes = card.find_elements(By.CSS_SELECTOR, 'span[aria-label="list"] p')
                    m2 = quartos = garagem = ''
                    for d in detalhes:
                        txt = d.text.lower()
                        if 'm²' in txt or 'm2' in txt:
                            m2 = d.text
                        elif 'quarto' in txt:
                            quartos = d.text
                        elif 'garagem' in txt:
                            garagem = d.text

                    emit({
                        "site": "ChavesNaMao",
                        "nome": titulo or "",
                        "imagem": sanitize_image(imagem),
                        "valor": valor or "",
                        "m2": m2,
                        "localizacao": localizacao,
                        "link": link,
                        "quartos": quartos,
                        "garagem": garagem,
                    })
                    total += 1
                except Exception:
                    continue

            # scroll to load more
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(3)
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                attempts += 1
                if attempts >= 2:
                    break
            else:
                attempts = 0
            last_height = new_height

        log(f"[ChavesNaMao] Emitidos: {total}")
    except Exception as e:
        log(f"[ChavesNaMao] Erro: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        log("[ChavesNaMao] Finalizado.")


# ---------------------------
# Run scraper internally (used by GUI)
# ---------------------------

SCRAPER_MAP = {
    "netimoveis": scraping_netimoveis,
    "casamineira": scraping_casamineira,
    "imovelweb": scraping_imovelweb,
    "zapimoveis": scraping_zapimoveis,
    "vivareal": scraping_vivareal,
    "olx": scraping_olx,
    "quintoandar": scraping_quintoandar,
    "loft": scraping_loft,
    "chavesnamao": scraping_chavesnamao,
}


def run_scraper_internal(selected_sites: Dict[str, bool], filtros: FiltrosType, headless: bool = True, timeout: int = DEFAULT_SCRAPER_TIMEOUT) -> List[Dict[str, Any]]:
    """
    Executa os scrapers selecionados sincronamente (usa threads internamente por scraper quando necessário).
    Retorna lista com os itens coletados.
    """
    results: List[Dict[str, Any]] = []
    lock = threading.Lock()

    def make_emit():
        def emit(obj: Dict[str, Any]):
            try:
                # sanitize minimal fields
                obj["imagem"] = sanitize_image(obj.get("imagem", ""))
                with lock:
                    results.append(obj)
            except Exception:
                pass
        return emit

    emit = make_emit()
    threads = []

    # Run each selected scraper in its own thread to parallelize
    for key, selected in (selected_sites or {}).items():
        if not selected:
            continue
        func = SCRAPER_MAP.get(key)
        if not func:
            log(f"[scraper] Site {key} não suportado internamente (ignorado).")
            continue
        t = threading.Thread(target=lambda f=func: f(emit, filtros, headless))
        t.daemon = True
        t.start()
        threads.append(t)

    # Wait for threads to finish or until timeout
    start = time.time()
    for t in threads:
        remaining = max(0, timeout - (time.time() - start))
        t.join(remaining)
    # threads left alive after timeout will be left to finish (driver quit is attempted inside scrapers)
    return results


# ---------------------------
# GUI (Flet) - adapted to call internal run_scraper_internal
# (rest of GUI unchanged)
# ---------------------------

@dataclass
class Property:
    id: str
    nome: str
    imagem: str
    valor: str
    m2: str
    localizacao: str
    link: str
    quartos: str
    garagem: str
    banhos: str = ""
    site: str = ""
    tags: List[str] = field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    def __hash__(self):
        return hash(self.link)

    def __eq__(self, other):
        if isinstance(other, Property):
            return self.link == other.link
        return False


class ScraperGUI:
    def __init__(self, page: ft.Page):
        self.page = page
        self.page.title = "Melhor Casa - Web Scraper (Integrado)"
        self.page.window_width = 1400
        self.page.window_height = 900
        self.page.theme_mode = ft.ThemeMode.LIGHT

        self.scraping = False
        self.properties: List[Property] = []
        self.liked_properties: List[Property] = []
        self.disliked_properties: List[Property] = []
        self.user_location: Optional[Dict[str, Any]] = None

        self.current_view = "busca"
        self.pesquisa_automatica: bool = False

        # UI controls placeholders
        self.site_checks = {}
        self.tipo_checks = {}
        self.cidade_input = None
        self.bairro_input = None
        self.start_button = None
        self.stop_button = None
        self.export_button = None

        # build UI
        self.setup_ui()
        # load saved state if exists
        try:
            self.load_state()
        except Exception as e:
            print("Erro ao carregar estado:", e)

        # Dispara scraping automático após carregar estado, se marcado
        if self.pesquisa_automatica:
            threading.Thread(target=self._auto_start_scraping_on_open, daemon=True).start()
    import time

    def _auto_start_scraping_on_open(self):
        # Espera carregamento da interface/state
        time.sleep(0.5)
        try:
            # Pegue os sites do state se existir, senão da interface atual
            state_path = self._state_file()
            selected_sites = {}
            if os.path.exists(state_path):
                with open(state_path, "r", encoding="utf-8") as f:
                    state = json.load(f)
                selected_sites = state.get("selected_sites", {})
                # Aplica nos controles UI (opcional)
                for k, v in selected_sites.items():
                    if k in getattr(self, 'site_checks', {}):
                        try:
                            self.site_checks[k].value = v
                        except Exception:
                            pass
                # Aplica outros filtros do state
                filters = state.get("filters", {})
                if getattr(self, 'valormin_input', None) and 'valormin' in filters:
                    self.valormin_input.value = filters.get('valormin','')
                if getattr(self, 'valormax_input', None) and 'valormax' in filters:
                    self.valormax_input.value = filters.get('valormax','')
                if getattr(self, 'cidade_input', None) and 'cidade' in filters:
                    self.cidade_input.value = filters.get('cidade','')
                if getattr(self, 'bairro_input', None) and 'bairro' in filters:
                    self.bairro_input.value = filters.get('bairro','')
                self.page.update()
            else:
                selected_sites = {k: v.value for k, v in getattr(self, 'site_checks', {}).items()}

            if not any(selected_sites.values()):
                print("Pesquisa automática: nenhum site selecionado, abortando.")
                return

            # INICIA o scraping de fato em background (garantindo flags/UI consistente com on_start_scraping)
            # Marca scraping = True e atualiza botões como se o usuário tivesse clicado em "Iniciar"
            self.scraping = True
            if getattr(self, "start_button", None): self.start_button.disabled = True
            if getattr(self, "stop_button", None): self.stop_button.disabled = False
            try:
                self.page.update()
            except Exception:
                pass

            # start scraping in a separate thread to avoid blocking UI
            threading.Thread(target=self.run_scraping, args=(selected_sites,), daemon=True).start()
        except Exception as e:
            print("Erro auto scraping:", e)

    def _filter(self, controls):
        return [c for c in (controls or []) if c is not None]

    def setup_ui(self):
        header = ft.Container(
            content=ft.Row(
                controls=self._filter([
                    ft.Icon(ft.Icons.HOME, size=32, color="#2563eb"),
                    ft.Column(controls=self._filter([ft.Text("Melhor Casa", size=24, weight="bold"), ft.Text("Ferramenta de coleta de imóveis", size=12, color="gray")])),
                    ft.Container(expand=True),
                    ft.IconButton(icon=ft.Icons.SETTINGS, on_click=lambda e: self.show_settings_dialog(), tooltip="Configurações"),
                ]),
                spacing=16,
                vertical_alignment="center",
            ),
            padding=16,
            bgcolor="#f9fafb",
            border_radius=8,
        )

        self.image_preview_container = ft.Container()
        self.site_checks = {}
        self.cidade_input = ft.TextField(label="Cidade", value="Belo Horizonte", width=150)
        self.bairro_input = ft.TextField(label="Bairro (Opcional)", value="", width=150)

        # TIPOS de imóvel: multi-seleção, checkbox separados, "indiferente" zera outros
        tipos = [("indiferente", "Indiferente"), ("apartamentos", "Apartamentos"), ("casas", "Casas")]
        self.tipo_checks = {}
        for key, label in tipos:
            cb = ft.Checkbox(label=label, value=(key == "apartamentos"))
            def make_on_change(k):
                def on_change(e):
                    try:
                        if k == "indiferente":
                            if e.control.value:
                                for tk, tcb in self.tipo_checks.items():
                                    if tk != "indiferente":
                                        tcb.value = False
                        else:
                            if e.control.value and "indiferente" in self.tipo_checks:
                                try:
                                    self.tipo_checks["indiferente"].value = False
                                except Exception:
                                    pass
                        self.page.update()
                    except Exception as ex:
                        print("Erro on_change tipo:", ex)
                return on_change
            cb.on_change = make_on_change(key)
            self.tipo_checks[key] = cb

        # Filtros detalhados
        self.valormin_input = ft.TextField(label="Valor Mínimo (R$)", value="", width=120)
        self.valormax_input = ft.TextField(label="Valor Máximo (R$)", value="250000", width=120)
        self.area_min_input = ft.TextField(label="Área Mínima (m²)", value="", width=120)
        self.area_max_input = ft.TextField(label="Área Máxima (m²)", value="", width=120)
        self.quartos_input = ft.TextField(label="Quartos (Ex: 2,3,4+)", value="", width=120)
        self.vagas_input = ft.TextField(label="Vagas (Ex: 1,2,3+)", value="", width=120)
        self.banhos_input = ft.TextField(label="Banheiros (Ex: 1,2,3+)", value="", width=120)
        self.sort_field = ft.Dropdown(label="Ordenar por", options=self._filter([
            ft.dropdown.Option("valor", "Valor"),
            ft.dropdown.Option("tamanho", "Tamanho (m²)"),
            ft.dropdown.Option("distancia", "Distância"),
        ]), value="valor", width=150, on_change=lambda e: self.on_sort_change())
        self.sort_direction = ft.Dropdown(label="Direção", options=self._filter([
            ft.dropdown.Option("asc", "Crescente"),
            ft.dropdown.Option("desc", "Decrescente"),
        ]), value="asc", width=120, on_change=lambda e: self.on_sort_change())

        # Botões principais
        self.pesquisa_auto_checkbox = ft.Checkbox(label="Pesquisa automática ao abrir (enviar email ao terminar)", value=self.pesquisa_automatica, on_change=self.on_toggle_pesquisa_automatica)
        self.start_button = ft.ElevatedButton(text="Iniciar Scraping", icon=ft.Icons.PLAY_CIRCLE_FILLED, on_click=self.on_start_scraping, width=150)
        self.stop_button = ft.ElevatedButton(text="Parar", icon=ft.Icons.STOP_CIRCLE, on_click=self.on_stop_scraping, disabled=True, width=150)
        self.export_button = ft.ElevatedButton(text="Exportar Excel", icon=ft.Icons.GET_APP, on_click=self.on_export_excel, width=150)

        # Filtros em linhas
        price_row = ft.Row(controls=self._filter([self.valormin_input, self.valormax_input]), spacing=8, wrap=True)
        area_row = ft.Row(controls=self._filter([self.area_min_input, self.area_max_input]), spacing=8, wrap=True)
        features_row = ft.Row(controls=self._filter([self.quartos_input, self.vagas_input, self.banhos_input]), spacing=8, wrap=True)
        sort_row = ft.Row(controls=self._filter([self.sort_field, self.sort_direction]), spacing=8, wrap=True)

        # Sites - organiza checbox em linhas
        sites = [
            ("Netimóveis", "netimoveis"),
            ("Casa Mineira", "casamineira"),
            ("Imóvel Web", "imovelweb"),
            ("Zap Imóveis", "zapimoveis"),
            ("Viva Real", "vivareal"),
##            ("OLX", "olx"),
##            ("Quinto Andar", "quintoandar"),
            ("Loft", "loft"),
            ("Chaves na Mão", "chavesnamao"),
##            ("Caixa Leilão", "caixa"),
        ]
        site_controls = []
        for label, key in sites:
            cb = ft.Checkbox(label=label, value=False)
            self.site_checks[key] = cb
            site_controls.append(cb)

        sites_column = ft.Column(controls=self._filter([
            ft.Text("Selecione os sites", weight="bold", size=12),
            ft.Row(controls=self._filter(site_controls[:3]), wrap=True, spacing=8),
            ft.Row(controls=self._filter(site_controls[3:6]), wrap=True, spacing=8),
            ft.Row(controls=self._filter(site_controls[6:]), wrap=True, spacing=8)
        ]), spacing=8)
        location_row = ft.Row(controls=self._filter([self.cidade_input, self.bairro_input]), spacing=8, wrap=True)
        tipo_row = ft.Row(controls=self._filter([cb for _, cb in self.tipo_checks.items()]), spacing=8, wrap=True)
        buttons_row = ft.Row(controls=self._filter([self.start_button, self.stop_button, self.export_button]), spacing=8, wrap=True)

        # Cards Busca, Favoritos, etc.
        busca_card = ft.Card(content=ft.Container(
            content=ft.Column(
                controls=self._filter([
                    ft.Text("Procura", size=14, weight="bold"),
                    sites_column,
                    ft.Text("Tipo de imóvel", size=12, weight="bold"), tipo_row,
                    location_row, price_row, area_row, features_row, sort_row,
                    self.pesquisa_auto_checkbox, buttons_row
                ]), spacing=12
            ),
            padding=16
        ), margin=0)

        self.tabs = ft.Tabs(
            tabs=[
                ft.Tab(
                    text="Busca",
                    icon="search",
                    content=ft.Container(
                        content=ft.Column(
                            controls=self._filter([
                                busca_card,
                                ft.Divider(),
                                ft.Row(
                                    controls=self._filter([
                                        ft.Text("Imóveis Encontrados", size=16, weight="bold"),
                                        ft.Container(expand=True),
                                        ft.IconButton(
                                            icon=ft.Icons.FAVORITE,
                                            tooltip="Ver favoritos",
                                            on_click=lambda e: self.switch_tab(1),
                                        ),
                                    ]),
                                    spacing=8,
                                ),
                                self.image_preview_container,
                                self.build_properties_view(),
                            ]),
                            expand=True,
                            spacing=8,
                            scroll="auto",
                        ),
                        padding=16,
                        expand=True,
                    ),
                ),
                ft.Tab(
                    text="Curtidas",
                    icon="favorite",
                    content=ft.Container(
                        content=ft.Column(
                            controls=self._filter([
                                ft.Row(
                                    controls=self._filter([
                                        ft.Text("Imóveis Favoritos", size=16, weight="bold"),
                                        ft.Container(expand=True),
                                        ft.IconButton(
                                            icon=ft.Icons.DELETE,
                                            tooltip="Limpar favoritos",
                                            on_click=self.clear_liked_properties,
                                        ),
                                    ]),
                                    spacing=8,
                                ),
                                self.build_liked_view(),
                            ]),
                            expand=True,
                            spacing=12,
                        ),
                        padding=16,
                        expand=True,
                    ),
                ),
                ft.Tab(
                    text="Rejeitadas",
                    icon="thumb_down",
                    content=ft.Container(
                        content=ft.Column(
                            controls=self._filter([
                                ft.Row(
                                    controls=self._filter([
                                        ft.Text("Imóveis Rejeitados", size=16, weight="bold"),
                                        ft.Container(expand=True),
                                        ft.IconButton(
                                            icon=ft.Icons.DELETE,
                                            tooltip="Limpar rejeitados",
                                            on_click=self.clear_disliked_properties,
                                        ),
                                    ]),
                                    spacing=8,
                                ),
                                self.build_disliked_view(),
                            ]),
                            expand=True,
                            spacing=12,
                        ),
                        padding=16,
                        expand=True,
                    ),
                ),
                ft.Tab(
                    text="Ranking",
                    icon="sort",
                    content=ft.Container(
                        content=ft.Column(
                            controls=self._filter([
                                ft.Row(
                                    controls=self._filter([
                                        ft.Text("Ranking de Imóveis", size=16, weight="bold"),
                                        ft.Container(expand=True),
                                        ft.IconButton(
                                            icon=ft.Icons.REFRESH,
                                            tooltip="Atualizar ranking",
                                            on_click=lambda e: self.refresh_ranking(),
                                        ),
                                    ]),
                                    spacing=8,
                                ),
                                self.build_ranking_view(),
                            ]),
                            expand=True,
                            spacing=12,
                        ),
                        padding=16,
                        expand=True,
                    ),
                ),
            ],
            expand=True,
        )

        self.status_text = ft.Text("Pronto", size=12, color="gray")
        self.status_indicator = ft.Container(width=12, height=12, border_radius=50, bgcolor="gray")
        self.status_stats = ft.Text(f"Total: 0 | Favoritos: 0 | Rejeitados: 0", size=12, color="gray")
        status_bar = ft.Container(content=ft.Row(controls=self._filter([self.status_indicator, self.status_text, ft.Container(expand=True), self.status_stats]), spacing=16, alignment="center"), padding=8, bgcolor="#f0f4f8", border_radius=8)

        main_content = ft.Container(content=ft.Column(controls=self._filter([header, ft.Divider(), self.tabs, ft.Divider(), status_bar]), expand=True, spacing=8), padding=12, expand=True)
        self.page.add(main_content)

    def build_properties_view(self) -> ft.Container:
        self.properties_view = ft.Column(scroll="auto", expand=True, spacing=12)
        return ft.Container(content=self.properties_view, expand=True)

    def build_liked_view(self) -> ft.Container:
        self.liked_view = ft.Column(scroll="auto", expand=True, spacing=12)
        return ft.Container(content=self.liked_view, expand=True)

    def build_disliked_view(self) -> ft.Container:
        self.disliked_view = ft.Column(scroll="auto", expand=True, spacing=12)
        return ft.Container(content=self.disliked_view, expand=True)

    def build_ranking_view(self) -> ft.Container:
        self.ranking_view = ft.Column(scroll="auto", expand=True, spacing=12)
        return ft.Container(content=self.ranking_view, expand=True)

    def switch_tab(self, index: int):
        self.tabs.selected_index = index
        self.page.update()

    def build_search_controls(self) -> ft.Card:
        sites = [
            ("Netimóveis", "netimoveis"),
            ("Casa Mineira", "casamineira"),
            ("Imóvel Web", "imovelweb"),
            ("Zap Imóveis", "zapimoveis"),
            ("Viva Real", "vivareal"),
            ("OLX", "olx"),
            ("Quinto Andar", "quintoandar"),
            ("Loft", "loft"),
            ("Chaves na Mão", "chavesnamao"),
            ("Caixa Leilão", "caixa"),
        ]
        site_controls = []
        for label, key in sites:
            cb = ft.Checkbox(label=label, value=False)
            self.site_checks[key] = cb
            site_controls.append(cb)

        sites_column = ft.Column(controls=self._filter([ft.Text("Selecione os sites", weight="bold", size=12), ft.Row(controls=self._filter(site_controls[:3]), wrap=True, spacing=8), ft.Row(controls=self._filter(site_controls[3:6]), wrap=True, spacing=8), ft.Row(controls=self._filter(site_controls[6:]), wrap=True, spacing=8)]), spacing=8)
        location_row = ft.Row(controls=self._filter([self.cidade_input, self.bairro_input]), spacing=8, wrap=True)
        tipo_row = ft.Row(controls=self._filter([cb for _, cb in self.tipo_checks.items()]), spacing=8, wrap=True)

        self.pesquisa_auto_checkbox = ft.Checkbox(label="Pesquisa automática ao abrir (enviar email ao terminar)", value=self.pesquisa_automatica, on_change=self.on_toggle_pesquisa_automatica)
        self.start_button = ft.ElevatedButton(text="Iniciar Scraping", icon=ft.Icons.PLAY_CIRCLE_FILLED, on_click=self.on_start_scraping, width=150)
        self.stop_button = ft.ElevatedButton(text="Parar", icon=ft.Icons.STOP_CIRCLE, on_click=self.on_stop_scraping, disabled=True, width=150)
        self.export_button = ft.ElevatedButton(text="Exportar Excel", icon=ft.Icons.GET_APP, on_click=self.on_export_excel, width=150)
        buttons_row = ft.Row(controls=self._filter([self.start_button, self.stop_button, self.export_button]), spacing=8, wrap=True)

        content = ft.Column(controls=self._filter([ft.Text("Procura", size=14, weight="bold"), sites_column, ft.Text("Tipo de imóvel", size=12, weight="bold"), tipo_row, location_row, self.pesquisa_auto_checkbox, buttons_row]), spacing=12)
        return ft.Card(content=ft.Container(content=content, padding=16), margin=0)

    def on_toggle_pesquisa_automatica(self, e):
        try:
            self.pesquisa_automatica = bool(e.control.value)
            try:
                self.save_state()
            except Exception:
                pass
            self.show_message(f"Pesquisa automática {'habilitada' if self.pesquisa_automatica else 'desabilitada'}", "info")
            self.page.update()
        except Exception as ex:
            print("Erro toggle pesquisa automatica:", ex)

    def build_filter_controls(self) -> ft.Card:
        self.valormin_input = ft.TextField(label="Valor Mínimo (R$)", value="", width=120)
        self.valormax_input = ft.TextField(label="Valor Máximo (R$)", value="250000", width=120)
        self.area_min_input = ft.TextField(label="Área Mínima (m²)", value="", width=120)
        self.area_max_input = ft.TextField(label="Área Máxima (m²)", value="", width=120)
        self.quartos_input = ft.TextField(label="Quartos (Ex: 2,3,4+)", value="", width=120)
        self.vagas_input = ft.TextField(label="Vagas (Ex: 1,2,3+)", value="", width=120)
        self.banhos_input = ft.TextField(label="Banheiros (Ex: 1,2,3+)", value="", width=120)
        self.sort_field = ft.Dropdown(label="Ordenar por", options=self._filter([ft.dropdown.Option("valor", "Valor"), ft.dropdown.Option("tamanho", "Tamanho (m²)"), ft.dropdown.Option("distancia", "Distância")]), value="valor", width=150, on_change=lambda e: self.on_sort_change())
        self.sort_direction = ft.Dropdown(label="Direção", options=self._filter([ft.dropdown.Option("asc", "Crescente"), ft.dropdown.Option("desc", "Decrescente")]), value="asc", width=120, on_change=lambda e: self.on_sort_change())
        price_row = ft.Row(controls=self._filter([self.valormin_input, self.valormax_input]), spacing=8, wrap=True)
        area_row = ft.Row(controls=self._filter([self.area_min_input, self.area_max_input]), spacing=8, wrap=True)
        features_row = ft.Row(controls=self._filter([self.quartos_input, self.vagas_input, self.banhos_input]), spacing=8, wrap=True)
        sort_row = ft.Row(controls=self._filter([self.sort_field, self.sort_direction]), spacing=8, wrap=True)
        content = ft.Column(controls=self._filter([ft.Text("Filtros", size=14, weight="bold"), price_row, area_row, features_row, ft.Divider(height=8), ft.Text("Ordenação", size=12, weight="bold"), sort_row]), spacing=12)
        return ft.Card(content=ft.Container(content=content, padding=16), margin=0)

    def on_sort_change(self):
        self.refresh_properties_display()

    #
    def show_settings_dialog(self, e=None):
        dlg = None

        # Campos de configuração: endereço, preferências de ranking
        location_input = ft.TextField(
            label="Seu endereço ou cidade",
            value=self.user_location.get("address", "") if self.user_location else self.cidade_input.value,
            width=350
        )

        ranking_priority = ft.Dropdown(
            label="Prioridade do ranking (quanto menor, mais importante)",
            options=[ft.dropdown.Option(str(i), f"Prioridade {i}") for i in range(1, 4)],
            value="1",
            width=200
        )

        tamanho_preferido = ft.TextField(
            label="Tamanho preferido (m²)",
            value="80",
            width=120
        )
        quartos_preferido = ft.TextField(
            label="Quartos preferidos",
            value="2",
            width=120
        )

        def save_settings(ev):
            nonlocal dlg
            try:
                # Exemplo simples: salva endereço na user_location
                self.user_location = {"address": location_input.value or ""}
                # Pode expandir depois para usar os filtros de ranking!
                self.show_message("Configurações salvas", "success")
                if dlg:
                    dlg.open = False
                    self.page.update()
                try:
                    self.save_state()
                except Exception:
                    pass
            except Exception as ex:
                self.show_message(f"Erro ao salvar: {str(ex)}", "error")

        dlg = ft.AlertDialog(
            title=ft.Text("Configurações"),
            content=ft.Column(
                controls=self._filter([
                    ft.Text("Localização e Preferências", weight="bold"),
                    location_input,
                    ft.Row(controls=self._filter([
                        ranking_priority,
                        tamanho_preferido,
                        quartos_preferido]), spacing=8),
                    ft.Text("Essas configurações ajudam a filtrar distâncias e ranquear imóveis conforme sua prioridade.", size=10, color="gray"),
                ]),
                tight=True,
                spacing=10,
            ),
            actions=[
                ft.TextButton("Cancelar", on_click=lambda ev: (setattr(dlg, 'open', False), self.page.update())),
                ft.TextButton("Salvar", on_click=save_settings),
            ]
        )
        self.page.dialog = dlg
        dlg.open = True
        self.page.update()

    # ---------------- Handlers (scraping/export) ----------------
    def on_start_scraping(self, e):
        if self.scraping:
            self.show_message("Scraping já em progresso", "warning")
            return
        selected_sites = {k: v.value for k, v in self.site_checks.items()}
        if not any(selected_sites.values()):
            self.show_message("Selecione pelo menos um site", "error")
            return
        try:
            self.save_state()
        except Exception:
            pass
        # mark scraping, update buttons, then start background thread
        self.scraping = True
        if self.start_button: self.start_button.disabled = True
        if self.stop_button: self.stop_button.disabled = False
        if getattr(self, "properties_view", None):
            self.properties_view.controls.clear()
        try:
            self.page.update()
        except Exception:
            pass
        thread = threading.Thread(target=self.run_scraping, args=(selected_sites,))
        thread.daemon = True
        thread.start()

    def on_stop_scraping(self, e):
        self.scraping = False
        if self.start_button: self.start_button.disabled = False
        if self.stop_button: self.stop_button.disabled = True
        self.update_status("Scraping pausado", "warning")

    def on_export_excel(self, e):
        if not self.properties:
            self.show_message("Nenhum imóvel para exportar", "error")
            return
        if openpyxl is None:
            self.show_message("Instale 'openpyxl' para exportar Excel: pip install openpyxl", "error")
            return
        try:
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "Imóveis"
            headers = ["Nome", "Valor", "M²", "Localização", "Quartos", "Garagem", "Banheiros", "Site", "Link", "Tags"]
            ws.append(headers)
            for prop in self.properties:
                ws.append([prop.nome, prop.valor, prop.m2, prop.localizacao, prop.quartos, prop.garagem, prop.banhos, prop.site, prop.link, ", ".join(prop.tags) if prop.tags else ""])
            filename = f"imoveis_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            wb.save(filename)
            self.show_message(f"Arquivo salvo: {filename}", "success")
        except Exception as ex:
            self.show_message(f"Erro ao exportar: {str(ex)}", "error")

    def _selected_tipos(self) -> List[str]:
        tipos = [k for k, cb in getattr(self, "tipo_checks", {}).items() if getattr(cb, "value", False)]
        if "indiferente" in tipos or len(tipos) == 0:
            return ["indiferente"]
        return tipos

    def _matches_tipo(self, item: Dict[str, Any], selected_tipos: List[str]) -> bool:
        if not selected_tipos or "indiferente" in selected_tipos:
            return True
        text = " ".join([str(item.get(k, "") or "") for k in ("tipo", "descricao", "nome", "titulo")]).lower()
        mappings = {
            "apartamentos": ["apart", "apto", "apartamento", "flat", "studio"],
            "casas": ["casa", "sobrado", "residencial", "chácara", "casa-"],
        }
        for sel in selected_tipos:
            keys = mappings.get(sel, [sel])
            for k in keys:
                if k in text:
                    return True
        return True

    def run_scraping(self, selected_sites: Dict[str, bool]):
        """
        Main scraping runner. Ensures self.scraping flag is set, runs internal scrapers,
        collects results and updates UI. Setting self.scraping=True here makes sure that
        callers that directly call run_scraping (like the auto-start path) will not
        have the results suppressed by the `if not self.scraping: break` guard.
        """
        try:
            # Ensure scraping flag is set and UI reflects the scraping state
            if not self.scraping:
                self.scraping = True
                if self.start_button: self.start_button.disabled = True
                if self.stop_button: self.stop_button.disabled = False
                try: self.page.update()
                except Exception: pass

            self.update_status("Iniciando scraping...", "info")
            filtros: FiltrosType = {
                "quartos": getattr(self, 'quartos_input', None).value if getattr(self, 'quartos_input', None) else "",
                "valorMax": getattr(self, 'valormax_input', None).value if getattr(self, 'valormax_input', None) else "",
                "valorMin": getattr(self, 'valormin_input', None).value if getattr(self, 'valormin_input', None) else "",
                "areaMin": getattr(self, 'area_min_input', None).value if getattr(self, 'area_min_input', None) else "",
                "areaMax": getattr(self, 'area_max_input', None).value if getattr(self, 'area_max_input', None) else "",
                "vagas": getattr(self, 'vagas_input', None).value if getattr(self, 'vagas_input', None) else "",
                "banhos": getattr(self, 'banhos_input', None).value if getattr(self, 'banhos_input', None) else "",
                "cidade": (self.cidade_input.value if self.cidade_input else ""),
                "tipo_imovel": ",".join(self._selected_tipos()),
                "endereco": (f"{self.bairro_input.value}, {self.cidade_input.value}" if getattr(self, 'bairro_input', None) and self.bairro_input.value else (self.cidade_input.value if self.cidade_input else "")),
            }
            # run internal scraper (parallel threads)
            results = run_scraper_internal(selected_sites, filtros, headless=True, timeout=DEFAULT_SCRAPER_TIMEOUT)
            # client-side filter by tipo
            tipos = self._selected_tipos()
            filtered_results = [r for r in results if self._matches_tipo(r, tipos)]
            self.properties = []
            for idx, item in enumerate(filtered_results):
                if not self.scraping:
                    break
                prop = Property(
                    id=item.get("id", f"prop-{idx}"),
                    nome=item.get("nome", f"Imóvel {idx + 1}"),
                    imagem=sanitize_image(item.get("imagem", "")),
                    valor=item.get("valor", "R$ 0"),
                    m2=item.get("m2", "0 m²"),
                    localizacao=item.get("localizacao", ""),
                    link=item.get("link", "#"),
                    quartos=item.get("quartos", ""),
                    garagem=item.get("garagem", "0"),
                    banhos=item.get("banhos", item.get("banheiros", "")),
                    site=item.get("site", ""),
                    tags=item.get("tags", []) or []
                )
                if not any(p.link == prop.link for p in self.properties):
                    self.properties.append(prop)
            self.refresh_properties_display()
            self.update_status(f"{len(self.properties)} imóveis encontrados", "success")
            try:
                self.save_state()
            except Exception:
                pass
            if self.pesquisa_automatica and self.properties:
                try:
                    threading.Thread(target=self._send_email_results, args=(self.properties,), daemon=True).start()
                except Exception as e:
                    print("Erro iniciando thread de envio de email:", e)
        except Exception as ex:
            self.update_status(f"Erro: {str(ex)[:100]}", "error")
        finally:
            # finalize scraping state
            self.scraping = False
            if self.start_button: self.start_button.disabled = False
            if self.stop_button: self.stop_button.disabled = True
            self.update_stats()
            try:
                self.page.update()
            except Exception:
                pass

    # (rest of GUI functions unchanged; omitted here for brevity)
   # ---------------- Correções solicitadas: abrir imagem e adicionar tag ----------------
    def _open_image(self, url: str):
        if not url:
            self.show_message("Imagem indisponível", "error")
            return
        dlg = ft.AlertDialog(
            modal=True,
            content=ft.Container(content=ft.Image(src=url, fit=ft.ImageFit.CONTAIN), padding=12, width=800, height=600),
            actions=[ft.TextButton(text="Fechar", on_click=lambda ev: (setattr(dlg, 'open', False), setattr(self.page, 'dialog', None), self.page.update()))],
        )
        self.page.dialog = dlg
        dlg.open = True
        self.page.update()

    def display_property(self, prop: Property, view: ft.Column = None):
        if view is None:
            view = self.properties_view
        thumb_url = sanitize_image(prop.imagem) if getattr(prop, 'imagem', None) else ""
        left_image = ft.Container(content=ft.Image(src=thumb_url, width=140, height=100, fit=ft.ImageFit.COVER) if thumb_url else ft.Icon(ft.Icons.IMAGE, size=64, color="gray"), border_radius=8, clip_behavior="anti_alias")
        btns = []
        def calc_btn(p):
            return ft.TextButton(text="Calcular entrada", on_click=lambda e, pp=p: self.calculate_entry(pp))
        btns.extend(self._filter([
            ft.ElevatedButton(text="❤️", on_click=lambda e, p=prop: self.like_property(p), width=50),
            ft.ElevatedButton(text="👎", on_click=lambda e, p=prop: self.dislike_property(p), width=50),
            ft.TextButton(text="Abrir link", on_click=lambda e, link=prop.link: self.open_link(link, prop)),
            ft.TextButton(text="Ampliar imagem", on_click=lambda e, url=thumb_url: self._open_image(url)),
            calc_btn(prop),
            ft.TextButton(text="Adicionar tag", on_click=lambda e, p=prop: self.show_tag_dialog(p)),
        ]))
        details_controls = [ft.Text(prop.nome, size=15, weight="bold", max_lines=2), ft.Row(controls=self._filter([ft.Icon(ft.Icons.LOCATION_ON, size=16, color="gray"), ft.Text(prop.localizacao, size=12, color="gray", max_lines=1)]), spacing=6), ft.Text(prop.valor, size=18, weight="bold", color="#16a34a")]
        chips = self._filter([ft.Container(content=ft.Text(prop.m2, size=11), padding=6, bgcolor="#f3f4f6", border_radius=6) if getattr(prop, 'm2', None) else None, ft.Container(content=ft.Text(prop.quartos or "", size=11), padding=6, bgcolor="#f3f4f6", border_radius=6) if getattr(prop, 'quartos', None) else None, ft.Container(content=ft.Text(f"{prop.garagem} vagas", size=11), padding=6, bgcolor="#f3f4f6", border_radius=6) if getattr(prop, 'garagem', None) else None, ft.Container(content=ft.Text(f"{prop.banhos}", size=11), padding=6, bgcolor="#f3f4f6", border_radius=6) if getattr(prop, 'banhos', None) else None, ft.Container(content=ft.Text(prop.site or "", size=11), padding=6, bgcolor="#f3f4f6", border_radius=6) if getattr(prop, 'site', None) else None])
        tags_row = None
        if getattr(prop, 'tags', None):
            tag_controls = [ft.Container(content=ft.Text(t, size=11), padding=6, bgcolor="#eef2ff", border_radius=6, margin=ft.margin.only(right=6)) for t in prop.tags]
            tags_row = ft.Row(controls=self._filter(tag_controls), spacing=6)
        content_controls = self._filter([ft.Row(controls=self._filter([left_image, ft.Column(controls=self._filter(details_controls), expand=True, spacing=6), ft.Column(controls=self._filter(btns), spacing=6)]), spacing=12, vertical_alignment="start"), ft.Row(controls=self._filter(chips), spacing=6, wrap=True), tags_row])
        card_content = ft.Column(controls=content_controls, spacing=8)
        card = ft.Card(content=ft.Container(content=card_content, padding=12), margin=ft.margin.only(bottom=8))
        view.controls.append(card)

    def create_property_display(self, prop: Property) -> ft.Column:
        thumb_url = sanitize_image(prop.imagem) if getattr(prop, 'imagem', None) else ""
        left_image = ft.Container(content=ft.Image(src=thumb_url, width=120, height=80, fit=ft.ImageFit.COVER) if thumb_url else ft.Icon(ft.Icons.IMAGE, size=48, color="gray"), border_radius=8, clip_behavior="anti_alias")
        controls = self._filter([ft.Row(controls=self._filter([left_image, ft.Column(controls=self._filter([ft.Text(prop.nome, size=14, weight="bold", max_lines=2), ft.Row(controls=self._filter([ft.Icon(ft.Icons.LOCATION_ON, size=16, color="gray"), ft.Text(prop.localizacao, size=11, color="gray", max_lines=1)]), spacing=4), ft.Text(prop.valor, size=16, weight="bold", color="#16a34a")]), expand=True, spacing=4), ft.TextButton(text="Abrir", on_click=lambda e, link=prop.link: self.open_link(link, prop)), ft.TextButton(text="Ampliar imagem", on_click=lambda e, url=thumb_url: self._open_image(url)), ft.TextButton(text="Calcular entrada", on_click=lambda e, p=prop: self.calculate_entry(p)), ft.TextButton(text="Adicionar tag", on_click=lambda e, p=prop: self.show_tag_dialog(p))]), spacing=12), ft.Row(controls=self._filter([ft.Chip(label=ft.Text(prop.m2, size=10)) if prop.m2 else None, ft.Chip(label=ft.Text(prop.quartos, size=10)) if prop.quartos else None, ft.Chip(label=ft.Text(f"{prop.garagem} vagas", size=10)) if prop.garagem else None, ft.Chip(label=ft.Text(f"{prop.banhos}", size=10)) if prop.banhos else None, ft.Chip(label=ft.Text(prop.site, size=10)) if prop.site else None]), spacing=4, wrap=True), ft.Text(", ".join(prop.tags), size=10, color="blue", max_lines=2) if prop.tags else None])
        return ft.Column(controls=controls, spacing=8)

    # tags
    def show_tag_dialog(self, prop: Property):
        try:
            if not hasattr(prop, 'tags') or prop.tags is None:
                prop.tags = []
            tag_input = ft.TextField(label="Nova tag", width=300)
            dlg = None
            def add_tag(e=None):
                nonlocal dlg
                try:
                    tag = (tag_input.value or "").strip()
                    if tag:
                        if tag not in prop.tags:
                            prop.tags.append(tag)
                            self.show_message(f"Tag '{tag}' adicionada", "success")
                        tag_input.value = ""
                        try:
                            self.refresh_properties_display()
                            self.refresh_liked_view()
                            self.refresh_disliked_view()
                            self.display_ranking()
                            self.save_state()
                        except Exception:
                            pass
                    if dlg:
                        dlg.open = False
                        self.page.dialog = None
                        try:
                            self.page.update()
                        except Exception:
                            pass
                except Exception as ex:
                    self.show_message(f"Erro ao adicionar tag: {ex}", "error")
            tag_input.on_submit = add_tag
            tag_input.autofocus = True
            dlg = ft.AlertDialog(title=ft.Text("Adicionar tag"), content=ft.Column(controls=self._filter([ft.Text(f"Imóvel: {prop.nome}", size=12), tag_input, ft.Text("Tags atuais: " + (", ".join(prop.tags) if prop.tags else "Nenhuma tag"), size=10, color="gray")]), tight=True, spacing=8), actions=self._filter([ft.TextButton(text="Cancelar", on_click=lambda ev: (setattr(dlg, 'open', False), setattr(self.page, 'dialog', None), self.page.update())), ft.TextButton(text="Adicionar", on_click=add_tag)]))
            self.page.dialog = dlg
            dlg.open = True
            self.page.update()
        except Exception as e:
            print("Erro show_tag_dialog:", e)
            try:
                self.show_message(f"Erro abrindo diálogo de tag: {e}", "error")
            except Exception:
                pass

    def like_property(self, prop):
        # Checa se já está nos favoritos, senão adiciona
        if prop not in self.liked_properties:
            self.liked_properties.append(prop)
            # Remove de rejeitados se estava lá
            self.disliked_properties = [p for p in self.disliked_properties if p != prop]
            self.refresh_properties_display()
            self.refresh_liked_view()
            self.refresh_disliked_view()
            self.display_ranking()
            self.save_state()
            self.show_message("Imóvel adicionado aos favoritos!", "success")

    def dislike_property(self, prop):
        if prop not in self.disliked_properties:
            self.disliked_properties.append(prop)
            # Remove de favoritos se estava lá
            self.liked_properties = [p for p in self.liked_properties if p != prop]
            self.refresh_properties_display()
            self.refresh_liked_view()
            self.refresh_disliked_view()
            self.display_ranking()
            self.save_state()
            self.show_message("Imóvel rejeitado!", "info")

    # like/dislike/save/load/status
    def refresh_properties_display(self):
        if not getattr(self, "properties_view", None):
            return
        self.properties_view.controls.clear()
        filtered_props = [p for p in self.properties if p not in self.liked_properties and p not in self.disliked_properties]
        for prop in filtered_props:
            self.display_property(prop, self.properties_view)
        self.page.update()

    def refresh_liked_view(self):
        if not getattr(self, "liked_view", None):
            return
        self.liked_view.controls.clear()
        for prop in self.liked_properties:
            self.display_property(prop, self.liked_view)
        self.page.update()

    def refresh_disliked_view(self):
        if not getattr(self, "disliked_view", None):
            return
        self.disliked_view.controls.clear()
        for prop in self.disliked_properties:
            self.display_property(prop, self.disliked_view)
        self.page.update()

    def remove_from_liked(self, prop: Property):
        try:
            self.liked_properties = [p for p in self.liked_properties if getattr(p, 'link', None) != getattr(prop, 'link', None)]
            self.refresh_liked_view(); self.update_stats(); self.show_message("Imóvel removido dos favoritos", "success")
        except Exception as e:
            self.show_message(f"Erro ao remover favorito: {e}", "error")

    def remove_from_disliked(self, prop: Property):
        try:
            self.disliked_properties = [p for p in self.disliked_properties if getattr(p, 'link', None) != getattr(prop, 'link', None)]
            self.refresh_disliked_view(); self.update_stats(); self.show_message("Imóvel removido de rejeitados", "success")
        except Exception as e:
            self.show_message(f"Erro ao remover rejeitado: {e}", "error")

    def clear_liked_properties(self, e):
        if len(self.liked_properties) == 0:
            self.show_message("Nenhum imóvel favorito", "info"); return
        self.liked_properties.clear(); self.refresh_liked_view(); self.update_stats(); self.show_message("Favoritos limpos", "success")

    def clear_disliked_properties(self, e):
        if len(self.disliked_properties) == 0:
            self.show_message("Nenhum imóvel rejeitado", "info"); return
        self.disliked_properties.clear(); self.refresh_disliked_view(); self.update_stats(); self.show_message("Rejeitados limpos", "success")

    def refresh_ranking(self, e=None):
        self.display_ranking()

    def display_ranking(self):
        if not getattr(self, "ranking_view", None):
            return
        self.ranking_view.controls.clear()
        if not self.liked_properties:
            empty = ft.Container(content=ft.Column(controls=self._filter([ft.Icon(ft.Icons.FAVORITE, size=64, color="gray"), ft.Text("Nenhum imóvel nos favoritos", size=16, color="gray"), ft.Text("Adicione imóveis aos favoritos para gerar ranking", size=12, color="gray")] ), horizontal_alignment="center", spacing=16), alignment=ft.alignment.center)
            self.ranking_view.controls.append(empty); self.page.update(); return
        for idx, prop in enumerate(self.liked_properties, 1):
            def move_up_factory(p): return lambda e: self.move_ranking(p, -1)
            def move_down_factory(p): return lambda e: self.move_ranking(p, 1)
            ranking_card = ft.Column(controls=self._filter([ft.Row(controls=self._filter([ft.Text(f"#{idx}", size=20, weight="bold", color="#2563eb", width=50), ft.Text(f"⭐ Score: {max(0, 100 - (idx * 5))}%", size=14, color="orange", width=150), ft.IconButton(icon=ft.Icons.ARROW_UPWARD, tooltip="Mover para cima", on_click=move_up_factory(prop)), ft.IconButton(icon=ft.Icons.ARROW_DOWNWARD, tooltip="Mover para baixo", on_click=move_down_factory(prop))]), spacing=8), self.create_property_display(prop)]), spacing=8)
            card = ft.Card(content=ft.Container(content=ranking_card, padding=12), margin=ft.margin.only(bottom=8))
            self.ranking_view.controls.append(card)
        self.page.update()

    def move_ranking(self, prop: Property, direction: int):
        try:
            idx = next(i for i, p in enumerate(self.liked_properties) if getattr(p, 'link', None) == getattr(prop, 'link', None))
        except StopIteration:
            return
        new_idx = idx + direction
        if new_idx < 0 or new_idx >= len(self.liked_properties):
            return
        self.liked_properties[idx], self.liked_properties[new_idx] = self.liked_properties[new_idx], self.liked_properties[idx]
        try: self.display_ranking()
        except Exception: pass
        try: self.save_state()
        except Exception: pass
        self.page.update()

    def format_currency(self, value: float) -> str:
        try:
            v = int(round(value)); s = f"{v:,}".replace(',', '.'); return f"R$ {s}"
        except Exception:
            return f"R$ {value}"

    def calculate_entry(self, prop: Property):
        try:
            base = parse_int(prop.valor)
            entrada = base * 0.20; itbi = base * 0.05; doc = base * 0.01
            total_initial = entrada + itbi + doc
            msg = (f"Valor: {self.format_currency(base)} | Entrada (20%): {self.format_currency(entrada)} | ITBI (5%): {self.format_currency(itbi)} | Doc (1%): {self.format_currency(doc)} | Total: {self.format_currency(total_initial)}")
            self.show_message(msg, "info")
            try: self.page.update()
            except Exception: pass
        except Exception as e:
            print("Erro calculate_entry:", e); self.show_message("Erro ao calcular entrada", "error")

    def open_link(self, link: str, prop: Optional[Property] = None):
        import webbrowser
        if link and link != "#":
            try: webbrowser.open(link)
            except Exception as ex: self.show_message(f"Erro ao abrir link: {str(ex)}", "error")
        else:
            self.show_message("Link indisponível", "error")

    # email results
    def _send_email_results(self, properties: List[Property]):
        try:
            msg = MIMEMultipart(); msg['From'] = EMAIL_FROM; msg['To'] = EMAIL_TO; msg['Date'] = formatdate(localtime=True)
            msg['Subject'] = f"Pesquisa automática - {len(properties)} imóveis encontrados em {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            corpo = "<h2>Resultados da Pesquisa Automática</h2>"
            corpo += f"<p>Pesquisa automática: Sim</p>"
            corpo += f"<p>Data: {datetime.now().strftime('%d/%m/%Y %H:%M')}</p>"
            corpo += "<ul>"
            for p in properties:
                corpo += "<li>"
                corpo += f"<strong>{p.nome}</strong> - {p.valor} - {p.m2} - {p.localizacao} - <a href='{p.link}'>link</a>"
                corpo += "</li>"
            corpo += "</ul>"
            msg.attach(MIMEText(corpo, 'html', 'utf-8'))  # <--- charset utf-8 aqui!
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as server:
                server.login(EMAIL_FROM, EMAIL_APP_PASSWORD)
                server.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_string())
            try: self.show_message("E-mail enviado com os resultados da pesquisa automática", "success")
            except Exception: pass
        except Exception as e:
            print("Erro ao enviar email de resultados:", e)
            try: self.show_message(f"Falha envio e-mail: {str(e)}", "warning")
            except Exception: pass

    # state
    def _state_file(self) -> str:
        return os.path.join(os.path.dirname(__file__), 'state.json')

    def save_state(self):
        try:
            state = {
                'properties': [p.__dict__ for p in self.properties],
                'liked': [p.__dict__ for p in self.liked_properties],
                'disliked': [p.__dict__ for p in self.disliked_properties],
                'filters': {
                    'valormin': getattr(self, 'valormin_input', None).value if getattr(self, 'valormin_input', None) else '',
                    'valormax': getattr(self, 'valormax_input', None).value if getattr(self, 'valormax_input', None) else '',
                    'cidade': getattr(self, 'cidade_input', None).value if getattr(self, 'cidade_input', None) else '',
                    'bairro': getattr(self, 'bairro_input', None).value if getattr(self, 'bairro_input', None) else '',
                    'tipo': self._selected_tipos(),
                },
                'selected_sites': {k: v.value for k, v in getattr(self, 'site_checks', {}).items()},
                'selected_tipos': self._selected_tipos(),
                'pesquisa_automatica': bool(self.pesquisa_automatica),
            }
            with open(self._state_file(), 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print('Failed to save state:', e)

    def load_state(self):
        try:
            path = self._state_file()
            if not os.path.exists(path):
                return
            with open(path, 'r', encoding='utf-8') as f:
                state = json.load(f)
            self.properties = [Property(**p) for p in state.get('properties', [])]
            self.liked_properties = [Property(**p) for p in state.get('liked', [])]
            self.disliked_properties = [Property(**p) for p in state.get('disliked', [])]
            self.pesquisa_automatica = bool(state.get('pesquisa_automatica', False))
            filters = state.get('filters', {})
            try:
                if getattr(self, 'valormin_input', None) and 'valormin' in filters:
                    self.valormin_input.value = filters.get('valormin','')
                if getattr(self, 'valormax_input', None) and 'valormax' in filters:
                    self.valormax_input.value = filters.get('valormax','')
                if getattr(self, 'cidade_input', None) and 'cidade' in filters:
                    self.cidade_input.value = filters.get('cidade','')
                if getattr(self, 'bairro_input', None) and 'bairro' in filters:
                    self.bairro_input.value = filters.get('bairro','')
            except Exception:
                pass
            sel = state.get('selected_sites', {})
            for k, v in sel.items():
                try:
                    if k in getattr(self, 'site_checks', {}):
                        self.site_checks[k].value = v
                except Exception:
                    pass
            sel_tipos = state.get('selected_tipos', [])
            try:
                for t, cb in getattr(self, 'tipo_checks', {}).items():
                    cb.value = t in sel_tipos
            except Exception:
                pass
            try:
                if hasattr(self, 'pesquisa_auto_checkbox'):
                    self.pesquisa_auto_checkbox.value = self.pesquisa_automatica
            except Exception:
                pass
            try:
                self.refresh_properties_display()
            except Exception:
                pass
            try:
                self.refresh_liked_view()
            except Exception:
                pass
            try:
                self.refresh_disliked_view()
            except Exception:
                pass
            try:
                self.display_ranking()
            except Exception:
                pass
            self.page.update()
        except Exception as e:
            print('Failed to load state:', e)

    # UI messages/status
    def show_message(self, message: str, msg_type: str = "info"):
        colors = {"success": "#16a34a", "error": "#dc2626", "warning": "#ea580c", "info": "#2563eb"}
        snack = ft.SnackBar(ft.Text(message, color="white"), bgcolor=colors.get(msg_type, "#2563eb"), duration=3000)
        self.page.overlay.append(snack)
        snack.open = True

    def update_stats(self):
        self.status_stats.value = f"Total: {len(self.properties)} | Favoritos: {len(self.liked_properties)} | Rejeitados: {len(self.disliked_properties)}"
        self.page.update()

    def update_status(self, message: str, status_type: str = "info"):
        colors = {"success": "#16a34a", "error": "#dc2626", "warning": "#ea580c", "info": "#2563eb"}
        self.status_text.value = message
        self.status_text.color = colors.get(status_type, "gray")
        self.status_indicator.bgcolor = colors.get(status_type, "gray")
        self.page.update()


def main(page: ft.Page):
    ScraperGUI(page)


if __name__ == "__main__":
    # Se quiser executar em modo CLI sem GUI:
    parser = argparse.ArgumentParser(description="MelhorCasa combinado (GUI + Scraper).")
    parser.add_argument("--nogui", action="store_true", help="Executar apenas o scraper no terminal (sem GUI)")
    parser.add_argument("--site", type=str, help="Site único para rodar (ex: netimoveis, zapimoveis)", default="")
    parser.add_argument("--cidade", type=str, default="belo horizonte")
    parser.add_argument("--endereco", type=str, default="")
    parser.add_argument("--stream", action="store_true", help="Se usar scraper CLI, imprime JSON dos resultados")
    args = parser.parse_args()

    if args.nogui:
        # Rodar scraper em modo CLI simples
        selected_sites = {}
        if args.site:
            selected_sites[args.site] = True
        else:
            # default example: netimoveis
            selected_sites = {"netimoveis": True}
        filtros = {"cidade": args.cidade, "endereco": args.endereco}
        results = run_scraper_internal(selected_sites, filtros, headless=True, timeout=300)
        if args.stream:
            for r in results:
                print(json.dumps(r, ensure_ascii=False))
        else:
            print(json.dumps(results, ensure_ascii=False))
    else:
        ft.app(target=main)
