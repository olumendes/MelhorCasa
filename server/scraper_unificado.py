# -*- coding: utf-8 -*-
"""
Unified Real Estate Scraper (BH, MG) - Server Version
Sites: QuintoAndar, Zap Imóveis, VivaReal, Casa Mineira, Chaves na Mão,
       Imovelweb, Loft, Netimóveis

- Headless Firefox (padrão) para todos os scrapers.
- Versão para servidor - executa sem interface gráfica
- Log em tempo real e arquivo 'scraper_unificado.log'.
- Exporta um único arquivo: 'imoveis_consolidado.xlsx' com colunas padronizadas.

Requisitos:
  pip install selenium pandas openpyxl
  Ter geckodriver/Firefox instalados e no PATH.
"""

import os
import re
import sys
import time
import logging
import threading
from dataclasses import dataclass, field
from typing import List, Dict, Tuple

import pandas as pd

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options as FxOptions
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, StaleElementReferenceException, JavascriptException
)

# ----------------------- LOG -----------------------
LOG_FILE = "scraper_unificado.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8"), logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("unified")

# -------------------- CONFIG/STATE -----------------
DEFAULT_CITY = "belo-horizonte"
DEFAULT_UF   = "mg"
DEFAULT_MAX  = 250000

stop_flag = threading.Event()

def ui_log(msg: str):
    log.info(msg)
    print(msg, flush=True)  # For server communication

def sleep_s(s: float):
    # interrupção respeita stop_flag
    t0 = time.time()
    while time.time() - t0 < s:
        if stop_flag.is_set():
            break
        time.sleep(0.05)

# ------------------- Driver Builder ----------------
def build_firefox(headless: bool = True, width: int = 1600, height: int = 1000) -> webdriver.Firefox:
    opts = FxOptions()
    if headless:
        os.environ["MOZ_HEADLESS"] = "1"
        opts.add_argument("--headless")
    opts.add_argument(f"--width={width}")
    opts.add_argument(f"--height={height}")
    # performance
    opts.set_preference("permissions.default.image", 2)  # bloqueia imagens
    opts.set_preference("dom.ipc.processCount", 1)
    opts.set_preference("dom.webnotifications.enabled", False)
    # carregar rápido
    opts.page_load_strategy = "eager"

    service = FirefoxService()
    drv = webdriver.Firefox(service=service, options=opts)
    drv.set_page_load_timeout(45)
    return drv

# ------------------- Helpers Genéricos -------------
def safe_text(node, bysel: Tuple[By, str]) -> str:
    by, sel = bysel
    try:
        return node.find_element(by, sel).text.strip()
    except Exception:
        return ""

def safe_attr(node, bysel: Tuple[By, str], attr: str) -> str:
    by, sel = bysel
    try:
        return node.find_element(by, sel).get_attribute(attr) or ""
    except Exception:
        return ""

def scroll_lazy(drv, steps: int = 6, pause: float = 0.35):
    for _ in range(steps):
        drv.execute_script("window.scrollBy(0, Math.max(500, window.innerHeight*0.9));")
        sleep_s(pause)

def wait_presence(drv, by: By, sel: str, timeout: int = 20):
    WebDriverWait(drv, timeout).until(EC.presence_of_all_elements_located((by, sel)))

def collect_data_row(
    fonte: str, titulo: str, imagem: str, valor: str, m2: str, quartos: str,
    banheiros: str, vagas: str, localizacao: str, link: str
) -> Dict[str, str]:
    return {
        "fonte": fonte,
        "título": titulo or "",
        "imagem": imagem or "",
        "valor": valor or "",
        "m²": m2 or "",
        "quartos": quartos or "",
        "banheiros": banheiros or "",
        "vagas": vagas or "",
        "localização": localizacao or "",
        "link": link or "",
    }

# ------------------- Scrapers ----------------------
def scrape_quintoandar(max_price: int) -> List[Dict[str, str]]:
    cidade = "belo-horizonte-mg-brasil"
    url = f"https://www.quintoandar.com.br/comprar/imovel/{cidade}/de-150000-a-{max_price}-venda"
    ui_log(f"[QuintoAndar] Acessando: {url}")
    data = []
    drv = build_firefox(headless=True)
    try:
        drv.get(url)
        wait_presence(drv, By.CSS_SELECTOR, '[data-testid="house-card-container"]')

        seen = set()
        rounds_no_new = 0

        def try_click_more() -> bool:
            sels = [
                (By.ID, "see-more"),
                (By.CSS_SELECTOR, '[data-testid="see-more-button"]'),
                (By.XPATH, "//button[contains(., 'Ver mais') or contains(., 'ver mais')]"),
                (By.XPATH, "//a[contains(., 'Ver mais') or contains(., 'ver mais')]"),
            ]
            clicked = False
            for by, sel in sels:
                try:
                    els = drv.find_elements(by, sel)
                    for e in els:
                        if e.is_displayed():
                            drv.execute_script("arguments[0].scrollIntoView({block:'center'});", e)
                            drv.execute_script("arguments[0].click();", e)
                            clicked = True
                            sleep_s(0.4)
                except Exception:
                    pass
            return clicked

        while not stop_flag.is_set():
            scroll_lazy(drv, steps=10, pause=0.25)
            cards = drv.find_elements(By.CSS_SELECTOR, '[data-testid="house-card-container"], [data-testid^="house-card"]')
            added_here = 0
            for c in cards:
                try:
                    link = ""
                    for a in c.find_elements(By.TAG_NAME, "a"):
                        href = a.get_attribute("href") or ""
                        if "/comprar/" in href:
                            link = href; break
                    if not link or link in seen:
                        continue
                    seen.add(link)

                    img = ""
                    try:
                        im = c.find_element(By.CSS_SELECTOR, "img")
                        img = im.get_attribute("src") or ""
                    except Exception:
                        pass

                    price = safe_text(c, (By.CSS_SELECTOR, '[data-testid="house-card-prices"]'))
                    info  = safe_text(c, (By.CSS_SELECTOR, '[data-testid="house-card-amenities"]'))
                    loc   = safe_text(c, (By.CSS_SELECTOR, '[data-testid="house-card-address"]'))
                    
                    # heurística para m2/quartos/vagas no 'info'
                    m2 = ""
                    quartos = vagas = banheiros = ""
                    m2m = re.search(r"(\d[\d\.,]*)\s*m", info or "")
                    if m2m: m2 = m2m.group(1).replace(".", "").replace(",", ".")
                    qm = re.search(r"(\d+)\s*quarto", info or "", flags=re.I)
                    if qm: quartos = qm.group(1)
                    vm = re.search(r"(\d+)\s*vaga", info or "", flags=re.I)
                    if vm: vagas = vm.group(1)

                    titulo = safe_attr(c, (By.TAG_NAME, "a"), "title")
                    data.append(collect_data_row("QuintoAndar", titulo, img, price, m2, quartos, banheiros, vagas, loc, link))
                    added_here += 1
                except Exception:
                    continue

            ui_log(f"[QuintoAndar] +{added_here} (total {len(seen)})")
            if added_here == 0:
                rounds_no_new += 1
            else:
                rounds_no_new = 0

            if not try_click_more() and rounds_no_new >= 2:
                break
    except Exception as e:
        ui_log(f"[QuintoAndar] ERRO: {e}")
    finally:
        try: drv.quit()
        except Exception: pass
    return data

def scrape_casamineira(max_price: int) -> List[Dict[str, str]]:
    base = "https://www.casamineira.com.br"
    url  = f"{base}/venda/casa/belo-horizonte_mg/preco-maximo-{max_price}"
    ui_log(f"[CasaMineira] Acessando: {url}")
    data = []
    drv = build_firefox(headless=True)
    try:
        drv.get(url)
        wait_presence(drv, By.CSS_SELECTOR, "div.postingCardLayout-module__posting-card-layout")
        while not stop_flag.is_set():
            cards = drv.find_elements(By.CSS_SELECTOR, "div.postingCardLayout-module__posting-card-layout")
            ui_log(f"[CasaMineira] {len(cards)} cards")
            for card in cards:
                try:
                    a = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_DESCRIPTION"] a')
                    nome = a.text.strip()
                    raw  = a.get_attribute("href") or ""
                    link = raw if raw.startswith("http") else f"{base}{raw}"
                    
                    img  = ""
                    try:
                        im = card.find_element(By.CSS_SELECTOR, "img.is-selected")
                        img = im.get_attribute("src") or im.get_attribute("data-flickity-lazyload") or ""
                    except Exception:
                        try:
                            im = card.find_element(By.CSS_SELECTOR, "img")
                            img = im.get_attribute("src") or im.get_attribute("data-flickity-lazyload") or ""
                        except Exception:
                            pass
                    
                    valor = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_PRICE"]').text.strip()
                    feats = card.find_elements(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_FEATURES"] span')
                    m2       = feats[0].text.strip() if len(feats) > 0 else ""
                    quartos  = feats[1].text.strip() if len(feats) > 1 else ""
                    banheiros= feats[2].text.strip() if len(feats) > 2 else ""
                    
                    rua_el   = card.find_elements(By.CLASS_NAME, 'postingLocations-module__location-address-in-listing')
                    rua      = rua_el[0].text.strip() if rua_el else ""
                    loc = card.find_element(By.CSS_SELECTOR, '[data-qa="POSTING_CARD_LOCATION"]').text.strip()
                    
                    data.append(collect_data_row("CasaMineira", nome, img, valor, m2, quartos, banheiros, "", f"{rua} | {loc}", link))
                except Exception:
                    continue
            
            # próxima página
            try:
                next_btn = drv.find_element(By.CSS_SELECTOR, 'a[data-qa="PAGING_NEXT"]')
                classes  = next_btn.get_attribute("class") or ""
                if "disabled" in classes or not next_btn.is_displayed():
                    break
                drv.execute_script("arguments[0].scrollIntoView({block:'center'});", next_btn)
                drv.execute_script("arguments[0].click();", next_btn)
                wait_presence(drv, By.CSS_SELECTOR, "div.postingCardLayout-module__posting-card-layout")
            except Exception:
                break
    except Exception as e:
        ui_log(f"[CasaMineira] ERRO: {e}")
    finally:
        try: drv.quit()
        except Exception: pass
    return data

# ------------------- Controller --------------------
@dataclass
class RunConfig:
    max_price: int = DEFAULT_MAX
    run_quintoandar: bool = True
    run_casamineira: bool = True

def run_selected(cfg: RunConfig) -> pd.DataFrame:
    all_rows: List[Dict[str, str]] = []
    
    # Execute scrapers
    tasks = []
    if cfg.run_quintoandar: tasks.append(("QuintoAndar", lambda: scrape_quintoandar(cfg.max_price)))
    if cfg.run_casamineira: tasks.append(("CasaMineira",lambda: scrape_casamineira(cfg.max_price)))

    for name, fn in tasks:
        if stop_flag.is_set(): break
        ui_log(f"[{name}] Iniciando…")
        try:
            part = fn() or []
            ui_log(f"[{name}] Coletados {len(part)} registros.")
            all_rows.extend(part)
        except Exception as e:
            ui_log(f"[{name}] ERRO geral: {e}")

    df = pd.DataFrame(all_rows, columns=[
        "fonte","título","imagem","valor","m²","quartos","banheiros","vagas","localização","link"
    ])
    
    # normaliza duplicados por Link
    if not df.empty and "link" in df.columns:
        df.drop_duplicates(subset=["link"], inplace=True, keep="first")
    
    return df

def main():
    ui_log("=== Iniciando Scraper Unificado (Servidor) ===")
    
    # Default configuration
    cfg = RunConfig(
        max_price=250000,
        run_quintoandar=True,
        run_casamineira=True
    )
    
    try:
        df = run_selected(cfg)
        if df.empty:
            ui_log("Nenhum dado coletado.")
        else:
            out = "imoveis_consolidado.xlsx"
            df.to_excel(out, index=False)
            ui_log(f"Concluído. {len(df)} únicos salvos em {out}")
    except Exception as e:
        ui_log(f"ERRO geral na execução: {e}")
    finally:
        ui_log("Fim do scraping.")

if __name__ == "__main__":
    main()
